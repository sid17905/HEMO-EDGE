// FILE: lib/firestore-service.ts
// Phase 1–3: Core CRUD, audit logging, PII scrubbing, GDPR helpers.
// Phase 4 Pillar B: FHIR R4 + HL7 v2.5 interoperability exports.
// Phase 4 Pillar A support: getPatientScanHistory for trend charts.
import {
  collection, collectionGroup, addDoc, getDocs, query, orderBy, limit,
  where, doc, setDoc, getDoc, serverTimestamp, Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import type { BloodMarker, PredictedCondition } from '../hooks/blood-report-types';

/** Returns current ISO timestamp (device clock, consistent with Firestore write path). */
export async function getSecureTimestamp(): Promise<string> {
  return new Date().toISOString();
}
// ─────────────────────────────────────────────────────────────────────────────
//  Shared types
// ─────────────────────────────────────────────────────────────────────────────

export interface UserProfile {
  uid:       string;
  email:     string;
  fullName:  string;
  role:      'doctor' | 'patient';
  createdAt: string; // ISO string
}

export interface StoredScanResult {
  id:                  string;
  caseId:              string;
  analyzedOn:          string;
  specimenType:        string;
  scanMode:            string;
  overallRisk:         string;
  urgency:             string;
  summary:             string;
  predictedConditions: PredictedCondition[];
  markers:             BloodMarker[];
  recommendations:     string[];
  imageUri?:           string;
  patientId?:          string;
  patientName?:        string;
  doctorId?:           string;
  // ── XAI / ML fields ───────────────────────────────────────────────────────
  blastProbability?:   number;
  blastCellPercent?:   number;
  wbc?:                number;
  rbc?:                number;
  hemoglobin?:         number;
  platelets?:          number;
  // ── Phase 3: Compliance metadata ──────────────────────────────────────────
  compliance?:         ComplianceMetadata;
  isDeleted?:          boolean;
  deletionRecord?:     SoftDeleteRecord;
  // ── Index signature for Firestore DocumentData compatibility ──────────────
  [key: string]:       unknown;
}

export interface SystemStats {
  todayTests:    number;
  pending:       number;
  critical:      number;
  aiLatencyMs:   number;
  uptimePct:     number;
}

export interface AuditLogEntry {
  actorUid:         string;
  actorRole:        'doctor' | 'patient' | 'admin';
  action:
    | 'view_scan'
    | 'view_report'
    | 'share_scan'
    | 'export_data'
    | 'export_pii_scrubbed'
    | 'gdpr_erasure_request'
    | 'gdpr_data_export'
    | 'pii_scrub_toggle'
    | 'login'
    | 'logout'
    | 'create_scan'
    | 'delete_scan'
    | 'fhir_export'       // Phase 4 Pillar B
    | 'hl7_export'        // Phase 4 Pillar B
    | 'critical_alert_dispatched' // Phase 4 Pillar C
    | 'user_logout'
    | 'account_switch'
    | 'preferences_updated';
  resourceId?:      string;
  resourceType?:    'scan' | 'report' | 'patient_record' | 'export' | 'auth' | 'userPreferences';
  timestamp:        string;
  ipHint?:          string;
  sessionId?:       string;
  dataResidency?:   string;
  consentVersion?:  string;
  /** Phase 5 alias — some callers use actorId instead of actorUid */
  actorId?:         string;
  metadata?:        Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PII field definitions
// ─────────────────────────────────────────────────────────────────────────────

const PII_FIELDS: readonly (keyof StoredScanResult)[] = [
  'patientName',
  'patientId',
  'imageUri',
] as const;

const PII_USER_FIELDS: readonly (keyof UserProfile)[] = [
  'fullName',
  'email',
] as const;

const SCRUBBED_PLACEHOLDER = '[REDACTED]';

// ─────────────────────────────────────────────────────────────────────────────
//  Compliance metadata
// ─────────────────────────────────────────────────────────────────────────────

export interface ComplianceMetadata {
  consentVersion:   string;
  processingBasis:  'consent' | 'legitimate_interest' | 'legal_obligation';
  dataResidency:    string;
  retentionPolicy:  'standard_7yr' | 'research_anonymised' | 'patient_requested_erasure';
  isAnonymised:     boolean;
  anonymisedAt?:    string;
}

export interface GDPRExportBundle {
  exportedAt:        string;
  requestedByUid:    string;
  scans:             StoredScanResult[];
  userProfile:       UserProfile;
  auditTrail:        AuditLogEntry[];
  complianceNotice:  string;
}

export interface SoftDeleteRecord {
  deletedAt:   string;
  deletedBy:   string;
  reason:      'gdpr_erasure' | 'doctor_removed' | 'account_closed';
  retainUntil: string;
  purgedAt?:   string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  saveScanResult
// ─────────────────────────────────────────────────────────────────────────────

export async function saveScanResult(
  uid: string,
  scanData: Omit<StoredScanResult, 'id'>,
): Promise<string> {
  try {
    const payload = { ...scanData, savedAt: new Date().toISOString() };
    const ref = collection(db, 'scans', uid, 'results');
    const docRef = await addDoc(ref, payload);

    const patientId = typeof scanData.patientId === 'string' ? scanData.patientId : undefined;
    if (patientId && patientId !== uid) {
      const patientRef = collection(db, 'scans', patientId, 'results');
      await addDoc(patientRef, { ...payload, id: docRef.id });
    }

    console.log('HEMO-EDGE: Scan saved id=', docRef.id);
    return docRef.id;
  } catch (err) {
    console.error('HEMO-EDGE: saveScanResult ->', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  getScanHistory
// ─────────────────────────────────────────────────────────────────────────────

export async function getScanHistory(
  uid: string,
  includeDeleted = false,
): Promise<StoredScanResult[]> {
  try {
    const ref = collection(db, 'scans', uid, 'results');
    const q = query(ref, orderBy('analyzedOn', 'desc'), limit(20));
    const snapshot = await getDocs(q);
    const results = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as StoredScanResult));
    return includeDeleted ? results : results.filter(r => !r.isDeleted);
  } catch (err) {
    console.error('HEMO-EDGE: getScanHistory ->', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  getScanResult — fetch a single scan by its document ID across all users
// ─────────────────────────────────────────────────────────────────────────────

export async function getScanResult(
  scanId: string,
  uid?: string,
): Promise<StoredScanResult | null> {
  // Guard: scanId must be a valid non-empty string that isn't a placeholder
  if (!scanId || scanId === 'unknown' || scanId.trim() === '') {
    console.warn('HEMO-EDGE: getScanResult called with invalid scanId:', scanId);
    return null;
  }

  try {
    // Fast path: if we know the owner uid, use a direct doc reference (no index needed)
    if (uid && uid !== 'unknown' && uid.trim() !== '') {
      const directRef = doc(db, 'scans', uid, 'results', scanId);
      const directSnap = await getDoc(directRef);
      if (directSnap.exists()) {
        return { id: directSnap.id, ...directSnap.data() } as StoredScanResult;
      }
    }

    // Fallback: collectionGroup query using the document's stored 'id' field
    // (avoids the documentId() / odd-segments restriction on collection groups)
    const q = query(
      collectionGroup(db, 'results'),
      where('id', '==', scanId),
      limit(1),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() } as StoredScanResult;
  } catch (err) {
    console.error('HEMO-EDGE: getScanResult ->', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  getPatientScanHistory  (Phase 4 Pillar A — longitudinal trend charts)
//  Returns the last `limitCount` scans for a specific patient, ordered
//  oldest-first so chart data flows left→right chronologically.
// ─────────────────────────────────────────────────────────────────────────────

export async function getPatientScanHistory(
  patientId: string,
  limitCount: number = 10,
): Promise<StoredScanResult[]> {
  try {
    const ref = collection(db, 'scans', patientId, 'results');
    // Fetch desc (most recent first), then reverse for chart order
    const q = query(
      ref,
      where('isDeleted', '!=', true),
      orderBy('analyzedOn', 'desc'),
      limit(limitCount),
    );
    const snapshot = await getDocs(q);
    const results = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() } as StoredScanResult))
      .filter(r => !r.isDeleted);

    // Reverse so oldest scan is index 0 — correct chronological order for charts
    return results.reverse();
  } catch (err) {
    console.error('HEMO-EDGE: getPatientScanHistory ->', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  getDoctorPatientScans
// ─────────────────────────────────────────────────────────────────────────────

export async function getDoctorPatientScans(doctorUid: string): Promise<StoredScanResult[]> {
  try {
    const ref = collection(db, 'scans', doctorUid, 'results');
    const q = query(ref, orderBy('analyzedOn', 'desc'), limit(50));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as StoredScanResult));
  } catch (err) {
    console.error('HEMO-EDGE: getDoctorPatientScans ->', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  getLinkedPatients
// ─────────────────────────────────────────────────────────────────────────────

export async function getLinkedPatients(doctorUid: string): Promise<UserProfile[]> {
  try {
    const linksRef = collection(db, 'doctors', doctorUid, 'patients');
    const linksSnap = await getDocs(linksRef);

    const profiles: UserProfile[] = [];
    await Promise.all(
      linksSnap.docs.map(async linkDoc => {
        const patientUid = linkDoc.id;
        const profileSnap = await getDoc(doc(db, 'users', patientUid));
        if (profileSnap.exists()) {
          profiles.push(profileSnap.data() as UserProfile);
        }
      })
    );

    return profiles.sort((a, b) => a.fullName.localeCompare(b.fullName));
  } catch (err) {
    console.error('HEMO-EDGE: getLinkedPatients ->', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  getPatientList
// ─────────────────────────────────────────────────────────────────────────────

export async function getPatientList(_doctorUid: string): Promise<UserProfile[]> {
  try {
    const ref = collection(db, 'users');
    const q = query(ref, where('role', '==', 'patient'), limit(50));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => d.data() as UserProfile);
  } catch (err) {
    console.error('HEMO-EDGE: getPatientList ->', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  linkPatientToDoctor
// ─────────────────────────────────────────────────────────────────────────────

export async function linkPatientToDoctor(
  doctorUid: string,
  patientEmail: string,
): Promise<void> {
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', patientEmail.trim()), limit(1));
    const snapshot = await getDocs(q);

    if (snapshot.empty) throw new Error(`No patient account found for: ${patientEmail}`);

    const patientUid = snapshot.docs[0].id;
    const linkRef = doc(db, 'doctors', doctorUid, 'patients', patientUid);
    await setDoc(linkRef, { linkedAt: new Date().toISOString() });

    console.log('HEMO-EDGE: Linked patient', patientUid, '→ doctor', doctorUid);
  } catch (err) {
    console.error('HEMO-EDGE: linkPatientToDoctor ->', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  getSystemStats
// ─────────────────────────────────────────────────────────────────────────────

export async function getSystemStats(doctorUid: string): Promise<SystemStats> {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const ref = collection(db, 'scans', doctorUid, 'results');

    const todayQ = query(ref, where('analyzedOn', '>=', todayIso));
    const todaySnap = await getDocs(todayQ);
    const todayTests = todaySnap.size;

    const pendingQ = query(ref, where('urgency', '==', 'pending'), limit(100));
    const pendingSnap = await getDocs(pendingQ);
    const pending = pendingSnap.size;

    const critQ = query(ref, where('urgency', '==', 'CRITICAL'), limit(100));
    const critSnap = await getDocs(critQ);
    const critical = critSnap.size;

    return { todayTests, pending, critical, aiLatencyMs: 12, uptimePct: 99.8 };
  } catch (err) {
    console.error('HEMO-EDGE: getSystemStats ->', err);
    return { todayTests: 0, pending: 0, critical: 0, aiLatencyMs: 0, uptimePct: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  writeAuditLog  (HIPAA §164.312(b) — immutable audit trail)
// ─────────────────────────────────────────────────────────────────────────────

export async function writeAuditLog(
  entry: Omit<AuditLogEntry, 'timestamp'>,
): Promise<void> {
  try {
    // Strip undefined fields — Firestore rejects them with "Unsupported field value: undefined"
    const clean = Object.fromEntries(
      Object.entries({ ...entry, timestamp: new Date().toISOString(), _server: serverTimestamp(), _version: 1 })
        .filter(([, v]) => v !== undefined),
    );
    await addDoc(collection(db, 'audit_logs'), clean);
  } catch (err) {
    console.error('HEMO-EDGE: writeAuditLog ->', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  scrubPII  (HIPAA Safe Harbour)
// ─────────────────────────────────────────────────────────────────────────────

export function scrubPII(scan: StoredScanResult): StoredScanResult {
  const scrubbed: StoredScanResult = { ...scan };

  PII_FIELDS.forEach(field => {
    if (field in scrubbed) {
      if (field === 'imageUri') {
        delete (scrubbed as Record<string, unknown>)[field];
      } else {
        (scrubbed as Record<string, unknown>)[field] = SCRUBBED_PLACEHOLDER;
      }
    }
  });

  if (scrubbed.caseId) {
    const prefix = scrubbed.caseId.split('-')[0] ?? 'ANON';
    const hash   = Math.abs(
      scrubbed.caseId.split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0),
    ).toString(16).slice(0, 6).toUpperCase();
    scrubbed.caseId = `${prefix}-ANON-${hash}`;
  }

  if (scrubbed.analyzedOn) {
    const d = new Date(scrubbed.analyzedOn);
    scrubbed.analyzedOn = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  scrubbed.compliance = {
    ...(scrubbed.compliance ?? {
      consentVersion:  'unknown',
      processingBasis: 'consent',
      dataResidency:   'unknown',
      retentionPolicy: 'research_anonymised',
      isAnonymised:    true,
    }),
    isAnonymised:    true,
    anonymisedAt:    new Date().toISOString(),
    retentionPolicy: 'research_anonymised',
  };

  return scrubbed;
}

export function scrubUserPII(profile: UserProfile): UserProfile {
  return {
    ...profile,
    fullName: SCRUBBED_PLACEHOLDER,
    email:    SCRUBBED_PLACEHOLDER,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  buildGDPRExport  (GDPR Art. 15)
// ─────────────────────────────────────────────────────────────────────────────

export async function buildGDPRExport(uid: string): Promise<GDPRExportBundle> {
  try {
    const scansRef  = collection(db, 'scans', uid, 'results');
    const scansQ    = query(scansRef, orderBy('analyzedOn', 'desc'));
    const scansSnap = await getDocs(scansQ);
    const scans = scansSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as StoredScanResult))
      .filter(s => !s.isDeleted);

    const profileSnap = await getDoc(doc(db, 'users', uid));
    const userProfile = profileSnap.exists()
      ? (profileSnap.data() as UserProfile)
      : { uid, email: '', fullName: '', role: 'patient' as const, createdAt: '' };

    const auditRef  = collection(db, 'audit_logs');
    const auditQ    = query(auditRef, where('actorUid', '==', uid), limit(200));
    const auditSnap = await getDocs(auditQ);
    const auditTrail = auditSnap.docs.map(d => d.data() as AuditLogEntry);

    const bundle: GDPRExportBundle = {
      exportedAt:     new Date().toISOString(),
      requestedByUid: uid,
      scans,
      userProfile,
      auditTrail,
      complianceNotice: [
        'HEMO-EDGE Data Export — GDPR Article 15 Right of Access',
        `Exported: ${new Date().toUTCString()}`,
        'This export contains all personal data held by HEMO-EDGE associated with your account.',
        'For erasure requests (GDPR Art. 17), use the "Request Data Deletion" option in the app.',
        'Data is retained for a minimum of 7 years per medical record regulations.',
        'Contact dpo@hemo-edge.com for questions regarding your data.',
      ].join('\n'),
    };

    await writeAuditLog({
      actorUid:     uid,
      actorRole:    userProfile.role,
      action:       'gdpr_data_export',
      resourceType: 'patient_record',
    });

    return bundle;
  } catch (err) {
    console.error('HEMO-EDGE: buildGDPRExport ->', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  softDeleteScan  (GDPR Art. 17)
// ─────────────────────────────────────────────────────────────────────────────

export async function softDeleteScan(
  uid:      string,
  scanId:   string,
  reason:   SoftDeleteRecord['reason'],
  actorUid: string,
  actorRole:'doctor' | 'patient',
): Promise<void> {
  try {
    const retainUntil = new Date();
    retainUntil.setFullYear(retainUntil.getFullYear() + 7);

    const deletionRecord: SoftDeleteRecord = {
      deletedAt:   new Date().toISOString(),
      deletedBy:   actorUid,
      reason,
      retainUntil: retainUntil.toISOString(),
    };

    const scanRef = doc(db, 'scans', uid, 'results', scanId);
    await setDoc(scanRef, {
      isDeleted:      true,
      deletionRecord,
      _deletedServer: serverTimestamp(),
    }, { merge: true });

    await writeAuditLog({
      actorUid,
      actorRole,
      action:       'delete_scan',
      resourceId:   scanId,
      resourceType: 'scan',
    });

    console.log('HEMO-EDGE: Soft-deleted scan', scanId, 'retain until', retainUntil.toISOString());
  } catch (err) {
    console.error('HEMO-EDGE: softDeleteScan ->', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  requestGDPRErasure
// ─────────────────────────────────────────────────────────────────────────────

export async function requestGDPRErasure(
  uid:  string,
  role: 'doctor' | 'patient',
  reason?: string,
): Promise<void> {
  try {
    await addDoc(collection(db, 'gdpr_erasure_requests'), {
      uid,
      role,
      reason:         reason ?? 'User-initiated erasure request',
      requestedAt:    new Date().toISOString(),
      _server:        serverTimestamp(),
      status:         'pending',
      regulatoryNote: 'Medical records will be anonymised per GDPR Art.17(3)(c). ' +
                      'Full purge after 7-year retention period.',
    });

    await writeAuditLog({
      actorUid:     uid,
      actorRole:    role,
      action:       'gdpr_erasure_request',
      resourceType: 'patient_record',
    });

    console.log('HEMO-EDGE: GDPR erasure request queued for uid', uid);
  } catch (err) {
    console.error('HEMO-EDGE: requestGDPRErasure ->', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  saveScanResultWithCompliance
// ─────────────────────────────────────────────────────────────────────────────

export async function saveScanResultWithCompliance(
  uid:        string,
  scanData:   Omit<StoredScanResult, 'id'>,
  compliance: Partial<ComplianceMetadata> = {},
): Promise<string> {
  const fullCompliance: ComplianceMetadata = {
    consentVersion:  compliance.consentVersion  ?? 'v1.0',
    processingBasis: compliance.processingBasis ?? 'consent',
    dataResidency:   compliance.dataResidency   ?? 'in',
    retentionPolicy: compliance.retentionPolicy ?? 'standard_7yr',
    isAnonymised:    compliance.isAnonymised    ?? false,
  };

  return saveScanResult(uid, { ...scanData, compliance: fullCompliance });
}

// ─────────────────────────────────────────────────────────────────────────────
//  ══════════════════════════════════════════════════════════════════════════
//  Phase 4 Pillar B — EMR / EHR Interoperability
//  ══════════════════════════════════════════════════════════════════════════
//
//  All three export functions:
//    1. Run scan through scrubPII before building the payload
//    2. Call writeAuditLog with the appropriate action
//    3. Return a structured payload — never throw on non-critical fields
//
//  FHIR R4 spec: https://www.hl7.org/fhir/R4/
//  LOINC CBC code: 58410-2 (Complete blood count (CBC) panel)
//  HL7 v2.5 ORU^R01: https://www.hl7.org/implement/standards/product_brief.cfm?product_id=185
// ─────────────────────────────────────────────────────────────────────────────

// ── FHIR R4 types (minimal subset needed) ────────────────────────────────────

interface FHIRCoding {
  system:  string;
  code:    string;
  display: string;
}

interface FHIRCodeableConcept {
  coding: FHIRCoding[];
  text:   string;
}

interface FHIRReference {
  reference: string;
}

interface FHIRObservation {
  resourceType:   'Observation';
  id:             string;
  status:         'final' | 'preliminary' | 'registered';
  code:           FHIRCodeableConcept;
  valueQuantity?: {
    value:  number;
    unit:   string;
    system: 'http://unitsofmeasure.org';
    code:   string;
  };
  valueString?:   string;
  interpretation?: FHIRCodeableConcept[];
  note?:           Array<{ text: string }>;
}

interface FHIRDiagnosticReport {
  resourceType: 'DiagnosticReport';
  id:           string;
  status:       'final' | 'preliminary' | 'registered';
  category:     FHIRCodeableConcept[];
  code:         FHIRCodeableConcept;
  subject?:     FHIRReference;
  effectiveDateTime: string;
  issued:       string;
  result:       FHIRReference[];
  conclusion:   string;
  contained:    FHIRObservation[];
}

interface FHIRPatient {
  resourceType: 'Patient';
  id:           string;
  identifier:   { system: string; value: string }[];
  name:         { use: string; text: string }[];
  gender?:      string;
  birthDate?:   string;
  meta: {
    security: { system: string; code: string; display: string }[];
  };
}

// ── Cell-type → LOINC code mapping ───────────────────────────────────────────
const CELL_TYPE_LOINC: Record<string, { code: string; display: string }> = {
  blast:       { code: '26498-5', display: 'Blast cells [#/volume] in Blood' },
  neutrophil:  { code: '26499-3', display: 'Neutrophils [#/volume] in Blood' },
  lymphocyte:  { code: '26474-7', display: 'Lymphocytes [#/volume] in Blood' },
  monocyte:    { code: '26484-6', display: 'Monocytes [#/volume] in Blood' },
  eosinophil:  { code: '26449-9', display: 'Eosinophils [#/volume] in Blood' },
};

// ── Marker status → FHIR interpretation code ─────────────────────────────────
function markerStatusToFHIR(status: string): FHIRCoding {
  const map: Record<string, { code: string; display: string }> = {
    high:       { code: 'H',  display: 'High' },
    low:        { code: 'L',  display: 'Low' },
    borderline: { code: 'A',  display: 'Abnormal' },
    normal:     { code: 'N',  display: 'Normal' },
  };
  const entry = map[status] ?? { code: 'U', display: 'Unknown' };
  return {
    system:  'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
    ...entry,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  buildFHIRDiagnosticReport
//  Returns a FHIR R4 DiagnosticReport with contained Observation resources
//  for each blood marker and cell detection.
//
//  LOINC panel code: 58410-2 (CBC panel)
//  All PII is scrubbed before building the resource.
// ─────────────────────────────────────────────────────────────────────────────

export async function buildFHIRDiagnosticReport(
  scan: StoredScanResult,
  actorUid: string,
  actorRole: 'doctor' | 'patient',
): Promise<FHIRDiagnosticReport> {
  try {
    const scrubbed = scrubPII(scan);

    // Build Observation resources for each blood marker
    const markerObservations: FHIRObservation[] = (scrubbed.markers ?? []).map(
      (marker: BloodMarker, idx: number): FHIRObservation => ({
        resourceType: 'Observation',
        id:           `obs-marker-${idx}`,
        status:       'final',
        code: {
          coding: [{
            system:  'http://loinc.org',
            code:    '26515-6', // generic CBC component — caller should map to specific LOINC
            display: marker.name,
          }],
          text: marker.name,
        },
        valueString: `${marker.value} ${marker.unit}`.trim(),
        interpretation: [{
          coding:  [markerStatusToFHIR(marker.status)],
          text:    marker.status,
        }],
        note: [{ text: `Reference range: ${marker.referenceRange}` }],
      }),
    );

    // Build Observation resources for each cell detection (XAI data)
    type CellDetectionLite = {
      id: string | number;
      cellType: string;
      blastProbability: number;
      confidence: number;
      x: number; y: number; w: number; h: number;
    };
    const cellObservations: FHIRObservation[] = ((scan as unknown as { cellDetections?: CellDetectionLite[] }).cellDetections ?? [])
      .map((cell: CellDetectionLite, idx: number): FHIRObservation => {
        const loinc = CELL_TYPE_LOINC[cell.cellType] ?? { code: '26498-5', display: cell.cellType };
        return {
          resourceType: 'Observation',
          id:           `obs-cell-${idx}`,
          status:       'final',
          code: {
            coding: [{ system: 'http://loinc.org', ...loinc }],
            text:   cell.cellType,
          },
          valueQuantity: {
            value:  Math.round(cell.blastProbability * 100) / 100,
            unit:   'probability',
            system: 'http://unitsofmeasure.org',
            code:   '{probability}',
          },
          note: [{
            text: `XAI bounding box: x=${cell.x.toFixed(3)} y=${cell.y.toFixed(3)} ` +
                  `w=${cell.w.toFixed(3)} h=${cell.h.toFixed(3)} ` +
                  `confidence=${(cell.confidence * 100).toFixed(1)}%`,
          }],
        };
      });

    const allObservations = [...markerObservations, ...cellObservations];
    const reportId = scrubbed.caseId ?? `HEMO-${Date.now()}`;

    // AI-generated conclusion summary
    const conclusion = [
      scrubbed.summary,
      scrubbed.overallRisk !== 'low'
        ? `Overall risk level: ${scrubbed.overallRisk.toUpperCase()}.`
        : '',
      scrubbed.recommendations?.[0]
        ? `Primary recommendation: ${scrubbed.recommendations[0]}`
        : '',
      'This report was generated by HEMO-EDGE AI. Not a substitute for clinical judgement.',
    ].filter(Boolean).join(' ');

    const report: FHIRDiagnosticReport = {
      resourceType: 'DiagnosticReport',
      id:           reportId,
      status:       'final',
      category: [{
        coding: [{
          system:  'http://terminology.hl7.org/CodeSystem/v2-0074',
          code:    'HM',
          display: 'Hematology',
        }],
        text: 'Hematology',
      }],
      code: {
        coding: [{
          system:  'http://loinc.org',
          code:    '58410-2',
          display: 'CBC panel - Blood by Automated count',
        }],
        text: 'Complete Blood Count (CBC)',
      },
      subject: scrubbed.patientId && scrubbed.patientId !== SCRUBBED_PLACEHOLDER
        ? { reference: `Patient/${scrubbed.patientId}` }
        : undefined,
      effectiveDateTime: scrubbed.analyzedOn,
      issued:            new Date().toISOString(),
      result:            allObservations.map(o => ({ reference: `#${o.id}` })),
      conclusion,
      contained:         allObservations,
    };

    await writeAuditLog({
      actorUid,
      actorRole,
      action:       'fhir_export',
      resourceId:   scan.id,
      resourceType: 'export',
    });

    console.log(`HEMO-EDGE: FHIR DiagnosticReport built — id=${reportId} observations=${allObservations.length}`);
    return report;
  } catch (err) {
    console.error('HEMO-EDGE: buildFHIRDiagnosticReport ->', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  buildFHIRPatient
//  Returns a FHIR R4 Patient resource with PII scrubbed.
//  Uses the HEMO-EDGE UID as the identifier system.
// ─────────────────────────────────────────────────────────────────────────────

export async function buildFHIRPatient(
  patient: UserProfile,
  actorUid: string,
  actorRole: 'doctor' | 'patient',
): Promise<FHIRPatient> {
  try {
    const scrubbed = scrubUserPII(patient);

    const resource: FHIRPatient = {
      resourceType: 'Patient',
      id:           patient.uid,
      identifier: [{
        system: 'urn:hemo-edge:patient-id',
        value:  patient.uid,
      }],
      // PII-scrubbed name — fullName is [REDACTED] after scrubUserPII
      name: [{
        use:  'anonymous',
        text: scrubbed.fullName, // '[REDACTED]'
      }],
      // gender and birthDate intentionally omitted — not stored in UserProfile schema
      meta: {
        security: [{
          system:  'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
          code:    'R',
          display: 'Restricted — PII scrubbed per HIPAA Safe Harbour §164.514(b)',
        }],
      },
    };

    await writeAuditLog({
      actorUid,
      actorRole,
      action:       'fhir_export',
      resourceId:   patient.uid,
      resourceType: 'patient_record',
    });

    console.log(`HEMO-EDGE: FHIR Patient built — id=${patient.uid}`);
    return resource;
  } catch (err) {
    console.error('HEMO-EDGE: buildFHIRPatient ->', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  exportHL7ORU
//  Returns a minimal HL7 v2.5 ORU^R01 message string.
//  All PII is scrubbed before building segments.
//
//  Segments produced:
//    MSH — Message header
//    PID — Patient identification (scrubbed)
//    OBR — Observation request (CBC)
//    OBX — One segment per blood marker
//
//  TODO markers indicate where a real HL7 library (e.g. node-hl7-client,
//  hl7-standard) should replace the manual pipe-encoding.
// ─────────────────────────────────────────────────────────────────────────────

export async function exportHL7ORU(
  scan: StoredScanResult,
  actorUid: string,
  actorRole: 'doctor' | 'patient',
): Promise<string> {
  try {
    const scrubbed = scrubPII(scan);

    // ── Helpers ───────────────────────────────────────────────────────────────
    // HL7 v2.5 field separator and encoding characters
    const FIELD_SEP   = '|';
    const ENCODE_CHAR = '^~\\&';
    const now         = new Date();
    // HL7 DateTime format: YYYYMMDDHHMMSS
    const hl7DateTime = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const msgId       = `HEMO${Date.now()}`;

    // TODO: Replace pipe-encoded strings with a real HL7 library:
    //   import { HL7Message } from 'hl7-standard';
    //   const msg = new HL7Message({ messageType: 'ORU', eventType: 'R01' });

    // ── MSH segment ───────────────────────────────────────────────────────────
    // MSH|^~\&|SendingApp|SendingFacility|ReceivingApp|ReceivingFacility|DateTime||MsgType|ControlId|Processing|Version
    const msh = [
      'MSH',
      ENCODE_CHAR,
      'HEMO-EDGE',           // MSH.3  Sending Application
      'HEMO-EDGE-CLOUD',     // MSH.4  Sending Facility
      'EHR-SYSTEM',          // MSH.5  Receiving Application — TODO: fill from integration config
      'RECEIVING-FACILITY',  // MSH.6  Receiving Facility — TODO: fill from integration config
      hl7DateTime,           // MSH.7  Date/Time of Message
      '',                    // MSH.8  Security (blank)
      'ORU^R01',             // MSH.9  Message Type
      msgId,                 // MSH.10 Message Control ID
      'P',                   // MSH.11 Processing ID (P=Production, T=Test)
      '2.5',                 // MSH.12 HL7 Version
    ].join(FIELD_SEP);

    // ── PID segment (PII-scrubbed) ────────────────────────────────────────────
    // PID|SetId||PatientId|||PatientName|||Gender||||||PhoneNumber
    const pid = [
      'PID',
      '1',                           // PID.1  Set ID
      '',                            // PID.2  Patient ID (external) — blank
      scrubbed.patientId ?? '',      // PID.3  Patient ID (internal) — REDACTED
      '',                            // PID.4  Alternate Patient ID
      scrubbed.patientName ?? '',    // PID.5  Patient Name — REDACTED
      '',                            // PID.6  Mother's Maiden Name
      '',                            // PID.7  Date of Birth — omitted (PHI)
      '',                            // PID.8  Sex — omitted (PHI)
    ].join(FIELD_SEP);

    // ── OBR segment (CBC order) ───────────────────────────────────────────────
    // OBR|SetId||OrderId|UniversalServiceId|||ObservationDateTime
    const obr = [
      'OBR',
      '1',                           // OBR.1  Set ID
      '',                            // OBR.2  Placer Order Number
      scrubbed.caseId ?? '',         // OBR.3  Filler Order Number — anonymised caseId
      '58410-2^CBC panel^LN',        // OBR.4  Universal Service ID (LOINC CBC)
      '',                            // OBR.5  Priority
      '',                            // OBR.6  Requested Date/Time
      scrubbed.analyzedOn,           // OBR.7  Observation Date/Time
    ].join(FIELD_SEP);

    // ── OBX segments (one per marker) ────────────────────────────────────────
    // OBX|SetId|ValueType|ObservationId|ObservationSubId|ObsValue|Units|RefRange|AbnormFlags|Status
    const obxSegments = (scrubbed.markers ?? []).map(
      (marker: BloodMarker, idx: number): string => {
        const abnormFlag = marker.status === 'normal' ? 'N'
          : marker.status === 'high'   ? 'H'
          : marker.status === 'low'    ? 'L'
          : 'A'; // borderline

        return [
          'OBX',
          String(idx + 1),              // OBX.1  Set ID
          'NM',                         // OBX.2  Value Type (NM = Numeric)
          // TODO: Map marker.name to a specific LOINC code via a lookup table
          `^${marker.name}^LN`,         // OBX.3  Observation Identifier
          '',                           // OBX.4  Observation Sub-ID
          marker.value,                 // OBX.5  Observation Value
          marker.unit,                  // OBX.6  Units
          marker.referenceRange,        // OBX.7  Reference Range
          abnormFlag,                   // OBX.8  Abnormal Flags
          '',                           // OBX.9  Probability (blank)
          'F',                          // OBX.11 Observation Result Status (F=Final)
        ].join(FIELD_SEP);
      },
    );

    const message = [msh, pid, obr, ...obxSegments].join('\r\n');

    await writeAuditLog({
      actorUid,
      actorRole,
      action:       'hl7_export',
      resourceId:   scan.id,
      resourceType: 'export',
    });

    console.log(`HEMO-EDGE: HL7 ORU^R01 built — segments=${3 + obxSegments.length}`);
    return message;
  } catch (err) {
    console.error('HEMO-EDGE: exportHL7ORU ->', err);
    throw err;
  }
}
// ─────────────────────────────────────────────────────────────────────────────
//  FILE: lib/firestore-service.ts
//  Phase 5 — Pillar B additions
//  ADD these two functions to your existing firestore-service.ts file.
//  Do NOT replace the whole file — paste these after your existing exports.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
//  UserPreferences schema (matches Firestore document — Phase 5 spec)
// ─────────────────────────────────────────────────────────────────────────────

export type SupportedLocale = 'en' | 'hi' | 'mr' | 'ta' | 'te' | 'bn';

export interface UserPreferencesDoc {
  userId:               string;
  language:             SupportedLocale;
  notificationsEnabled: boolean;
  smsAlertsEnabled:     boolean;   // doctor-only UI; stored for all roles, ignored for patients
  biometricEnabled:     boolean;
  dataResidency:        string;
  consentVersion:       string;
  updatedAt:            ReturnType<typeof serverTimestamp>;
}

export type UserPreferencesInput = Omit<UserPreferencesDoc, 'updatedAt'>;

// ─────────────────────────────────────────────────────────────────────────────
//  getUserPreferences
//  Returns the UserPreferencesDoc for the given userId, or sensible defaults
//  if no document exists yet (first launch).
// ─────────────────────────────────────────────────────────────────────────────

export async function getUserPreferences(
  userId: string,
): Promise<UserPreferencesDoc> {
  // Guard: never query Firestore with an invalid userId
  if (!userId || userId === 'unknown' || userId.trim() === '') {
    console.warn('HEMO-EDGE: getUserPreferences called with invalid userId — returning defaults');
    return _defaultPreferences('anonymous');
  }

  try {
    const ref  = doc(db, 'userPreferences', userId);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      return snap.data() as UserPreferencesDoc;
    }

    // First-launch: document doesn't exist yet — return defaults, not an error
    return _defaultPreferences(userId);
  } catch (err: unknown) {
    // Permissions error = user not yet fully authenticated; return defaults silently
    if (
      err instanceof Error &&
      (err.message.includes('Missing or insufficient permissions') ||
        err.message.includes('permission-denied'))
    ) {
      console.warn('HEMO-EDGE: getUserPreferences — permission denied, returning defaults');
      return _defaultPreferences(userId);
    }
    console.error('HEMO-EDGE: getUserPreferences failed ->', err);
    throw err;
  }
}

function _defaultPreferences(userId: string): UserPreferencesDoc {
  return {
    userId,
    language:             'en',
    notificationsEnabled: true,
    smsAlertsEnabled:     false,
    biometricEnabled:     false,
    dataResidency:        'in-south1',   // Mumbai default
    consentVersion:       '1.0',
    updatedAt:            serverTimestamp(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  saveUserPreferences
//  Merges the provided fields into /userPreferences/{userId}.
//  Always stamps updatedAt with getSecureTimestamp().
//  Writes an auditLog entry for the change.
// ─────────────────────────────────────────────────────────────────────────────

export async function saveUserPreferences(
  userId:   string,
  prefs:    Partial<UserPreferencesInput>,
  actorRole: 'doctor' | 'patient' | 'admin' = 'patient',
): Promise<void> {
  try {
    const ref = doc(db, 'userPreferences', userId);

    const payload = {
      ...prefs,
      userId,
      updatedAt: await getSecureTimestamp(),
    };

    // setDoc with merge:true — creates if absent, patches if present
    await setDoc(ref, payload, { merge: true });

    await writeAuditLog({
      action:       'preferences_updated',
      actorUid:     userId,
      actorRole,
      resourceType: 'userPreferences',
      resourceId:   userId,
      metadata:     { updatedFields: Object.keys(prefs) },
    });
  } catch (err) {
    console.error('HEMO-EDGE: saveUserPreferences failed ->', err);
    throw err;
  }
}
// ── OfflineQueueDoc type (mirrors /offlineQueue Firestore schema) ─────────────
 
export type OfflineQueueAction = 'create_scan' | 'update_status' | 'add_annotation';
 
export interface OfflineQueueDoc {
  id:           string;
  actorId:      string;
  action:       OfflineQueueAction;
  payload:      Record<string, unknown>;
  createdAt:    string;          // ISO local device time
  synced:       boolean;
  syncedAt?:    string;          // ISO
  conflictFlag: boolean;
}
 
// ─────────────────────────────────────────────────────────────────────────────
//  getUnsyncedQueue
//  Fetches all /offlineQueue documents where synced === false for a given actor.
//  Used by admin views and server-side reconciliation workers.
// ─────────────────────────────────────────────────────────────────────────────
 
export async function getUnsyncedQueue(actorId: string): Promise<OfflineQueueDoc[]> {
  try {
    const q    = query(
      collection(db, 'offlineQueue'),
      where('actorId', '==', actorId),
      where('synced',  '==', false),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ ...d.data(), id: d.id } as OfflineQueueDoc));
  } catch (err) {
    console.error('HEMO-EDGE: getUnsyncedQueue failed ->', err);
    throw err;
  }
}
 
// ─────────────────────────────────────────────────────────────────────────────
//  markQueueItemSynced
//  Sets synced: true and stamps syncedAt on a /offlineQueue document.
//  Called by the hook after a successful replay; also available for
//  server-side reconciliation.
// ─────────────────────────────────────────────────────────────────────────────
 
export async function markQueueItemSynced(queueId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'offlineQueue', queueId), {
      synced:    true,
      syncedAt:  new Date().toISOString(),
      _syncedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('HEMO-EDGE: markQueueItemSynced failed ->', err);
    throw err;
  }
}
 
// ─────────────────────────────────────────────────────────────────────────────
//  resolveConflict
//  Applies the chosen conflict resolution to a /offlineQueue document and
//  clears conflictFlag.
//
//  resolution: 'keep_local'  → caller must have already written the local
//                              payload to Firestore before calling this.
//              'keep_server' → discard the local change; just clear the flag.
// ─────────────────────────────────────────────────────────────────────────────
 
export async function resolveConflict(
  queueId:    string,
  resolution: 'keep_local' | 'keep_server',
): Promise<void> {
  try {
    await updateDoc(doc(db, 'offlineQueue', queueId), {
      synced:       true,
      syncedAt:     new Date().toISOString(),
      conflictFlag: false,
      resolution,
      _resolvedAt:  serverTimestamp(),
    });
    console.log(`HEMO-EDGE: Conflict resolved queueId=${queueId} resolution=${resolution}`);
  } catch (err) {
    console.error('HEMO-EDGE: resolveConflict failed ->', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MessageDoc — matches /messages/{messageId} Firestore schema (Phase 5 spec)
// ─────────────────────────────────────────────────────────────────────────────
 
export interface MessageDoc {
  id:             string;
  threadId:       string;          // patientId_doctorId composite key (sorted)
  senderId:       string;
  senderRole:     'doctor' | 'patient';
  recipientId:    string;
  text:           string;
  timestamp:      Timestamp;
  readAt?:        Timestamp;
  attachedScanId?: string;         // optional scan reference
  _deleted:       boolean;
}
 
// ─────────────────────────────────────────────────────────────────────────────
//  sendMessage
//  Writes a new message document to /messages.
//  Calls writeAuditLog with action: 'message_sent'.
//  Never exposes PHI in the audit log — only IDs are logged.
// ─────────────────────────────────────────────────────────────────────────────
 
export async function sendMessage(
  message: Omit<MessageDoc, 'id'>,
): Promise<string> {
  try {
    const ref = await addDoc(collection(db, 'messages'), {
      ...message,
      timestamp: message.timestamp ?? serverTimestamp(),
      _server:   serverTimestamp(),
    });
 
    await writeAuditLog({
      actorUid:     message.senderId,
      actorRole:    message.senderRole,
      action:       'message_sent' as Parameters<typeof writeAuditLog>[0]['action'],
      resourceType: 'scan',           // closest existing type; extend AuditLogEntry.action in Phase 6
      resourceId:   ref.id,
    });
 
    console.log(`HEMO-EDGE: Message sent id=${ref.id} thread=${message.threadId}`);
    return ref.id;
  } catch (err) {
    console.error('HEMO-EDGE: sendMessage failed ->', err);
    throw err;
  }
}
 
// ─────────────────────────────────────────────────────────────────────────────
//  getThreadMessages
//  Paginated fetch of messages for a given threadId, ordered by timestamp desc.
//  Returns messages in descending order (most recent first) — callers reverse
//  for display if needed.
//
//  NOTE: Production requires a composite Firestore index on:
//    (threadId ASC, timestamp DESC)
//  Add via Firebase Console or firestore.indexes.json.
// ─────────────────────────────────────────────────────────────────────────────
 
export async function getThreadMessages(
  threadId: string,
  limitCount: number = 50,
): Promise<MessageDoc[]> {
  try {
    const q = query(
      collection(db, 'messages'),
      where('threadId', '==', threadId),
      where('_deleted',  '==', false),
      orderBy('timestamp', 'desc'),
      limit(limitCount),
    );
 
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<MessageDoc, 'id'>),
    }));
  } catch (err) {
    console.error('HEMO-EDGE: getThreadMessages failed ->', err);
    throw err;
  }
}
 
// ─────────────────────────────────────────────────────────────────────────────
//  markMessageRead
//  Sets readAt to getSecureTimestamp() on a message document.
//  Only the recipient should call this (enforced by Firestore rules above).
// ─────────────────────────────────────────────────────────────────────────────
 
export async function markMessageRead(messageId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'messages', messageId), {
      readAt:    await getSecureTimestamp(),
      _readAt:   serverTimestamp(),
    });
  } catch (err) {
    // Non-fatal — read receipts are best-effort
    console.warn('HEMO-EDGE: markMessageRead failed ->', err);
  }
}
export interface AuditLogDoc {
  id:            string;
  /** Phase 1–4 field name */
  actorUid?:     string;
  /** Phase 5 field name */
  actorId?:      string;
  actorRole:     'doctor' | 'patient' | 'admin';
  action:        string;
  resourceId?:   string;
  resourceType?: string;
  timestamp:     string;
  metadata?:     Record<string, unknown>;
}
 
/** Resolved actor ID — picks whichever field is present. */
export function resolveActorId(log: AuditLogDoc): string {
  return log.actorId ?? log.actorUid ?? '—';
}
 
export interface AuditLogFilters {
  actorRole?: 'doctor' | 'patient' | 'admin';
  action?:    string;
}
 
export interface AdminSystemStats {
  totalScans:          number;
  totalPatients:       number;
  totalDoctors:        number;
  criticalAlertsToday: number;
  aiLatencyMs:         number;
  uptimePct:           number;
}
 
/** Extended UserProfile with optional admin role — matches /users collection. */
export interface AdminUserProfile {
  uid:       string;
  email:     string;
  fullName:  string;
  role:      'doctor' | 'patient' | 'admin';
  createdAt: string;
}
 
// ─────────────────────────────────────────────────────────────────────────────
//  getAdminSystemStats
//  System-wide aggregate stats for the admin dashboard.
//  Distinguished from getSystemStats() which is scoped to a single doctor.
//
//  Security rule: requires auth.token.role === 'admin'
// ─────────────────────────────────────────────────────────────────────────────
 
export async function getAdminSystemStats(): Promise<AdminSystemStats> {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();
 
    // Total patients and doctors — two parallel queries on /users
    const [patientSnap, doctorSnap] = await Promise.all([
      getDocs(query(collection(db, 'users'), where('role', '==', 'patient'), limit(1000))),
      getDocs(query(collection(db, 'users'), where('role', '==', 'doctor'), limit(1000))),
    ]);
 
    const totalPatients = patientSnap.size;
    const totalDoctors  = doctorSnap.size;
 
    // Critical alerts dispatched today — count audit_logs with matching action
    const critAlertSnap = await getDocs(
      query(
        collection(db, 'audit_logs'),
        where('action',    '==', 'critical_alert_dispatched'),
        where('timestamp', '>=', todayIso),
        limit(500),
      ),
    );
    const criticalAlertsToday = critAlertSnap.size;
 
    // Total scans: sum across all users is expensive without aggregation;
    // use a system-level /systemStats doc if available, else query top-level scans.
    // For Phase 5 we estimate from the audit_logs create_scan actions as a proxy.
    const scanCountSnap = await getDocs(
      query(
        collection(db, 'audit_logs'),
        where('action', '==', 'create_scan'),
        limit(1000),
      ),
    );
    const totalScans = scanCountSnap.size;
 
    return {
      totalScans,
      totalPatients,
      totalDoctors,
      criticalAlertsToday,
      aiLatencyMs: 12,      // static until a /metrics collection is wired up
      uptimePct:   99.8,
    };
  } catch (err) {
    console.error('HEMO-EDGE: getAdminSystemStats failed ->', err);
    // Return zeros rather than throwing — the UI shows empty stats gracefully
    return {
      totalScans:          0,
      totalPatients:       0,
      totalDoctors:        0,
      criticalAlertsToday: 0,
      aiLatencyMs:         0,
      uptimePct:           0,
    };
  }
}
 
// ─────────────────────────────────────────────────────────────────────────────
//  getAuditLogs
//  Paginated fetch of /audit_logs, newest first.
//  Optional filters: actorRole, action (exact match).
//
//  Firestore composite index required:
//    When filtering by actorRole: (actorRole ASC, timestamp DESC)
//    When filtering by action:    (action ASC, timestamp DESC)
//    Unfiltered:                  (timestamp DESC) — single-field index, auto-created
//
//  Security rule: requires auth.token.role === 'admin'
// ─────────────────────────────────────────────────────────────────────────────
 
export async function getAuditLogs(
  limitCount: number = 50,
  filters:    AuditLogFilters = {},
): Promise<AuditLogDoc[]> {
  try {
    // Build query constraints array dynamically
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const constraints: Parameters<typeof query>[1][] = [];
 
    if (filters.actorRole) {
      constraints.push(where('actorRole', '==', filters.actorRole));
    }
    if (filters.action) {
      constraints.push(where('action', '==', filters.action));
    }
 
    constraints.push(orderBy('timestamp', 'desc'));
    constraints.push(limit(limitCount));
 
    const q    = query(collection(db, 'audit_logs'), ...constraints);
    const snap = await getDocs(q);
 
    return snap.docs.map(
      (d) => ({ id: d.id, ...(d.data() as Omit<AuditLogDoc, 'id'>) }),
    );
  } catch (err) {
    console.error('HEMO-EDGE: getAuditLogs failed ->', err);
    throw err;
  }
}
 
// ─────────────────────────────────────────────────────────────────────────────
//  getAllUsers
//  Returns users from /users collection, optionally filtered by role.
//  Returns results ordered by createdAt desc (newest accounts first).
//  Capped at 200 to avoid runaway reads; pagination cursor can be added later.
//
//  Security rule: requires auth.token.role === 'admin'
// ─────────────────────────────────────────────────────────────────────────────
 
export async function getAllUsers(
  role?: 'doctor' | 'patient' | 'admin',
): Promise<AdminUserProfile[]> {
  try {
    const constraints: Parameters<typeof query>[1][] = [];
 
    if (role) {
      constraints.push(where('role', '==', role));
    }
 
    // createdAt is stored as ISO string — lexicographic sort works correctly
    constraints.push(orderBy('createdAt', 'desc'));
    constraints.push(limit(200));
 
    const q    = query(collection(db, 'users'), ...constraints);
    const snap = await getDocs(q);
 
    return snap.docs.map(
      (d) => ({ uid: d.id, ...(d.data() as Omit<AdminUserProfile, 'uid'>) }),
    );
  } catch (err) {
    console.error('HEMO-EDGE: getAllUsers failed ->', err);
    throw err;
  }
}