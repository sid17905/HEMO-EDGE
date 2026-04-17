// FILE: hooks/use-blood-report-analysis.ts
// Phase 3: Auto audit-log on every analysis run.
// Phase 4 Pillar C: Smart Alerting — criticalScanDetector, Expo push
//   notification dispatch, Twilio SMS stub, alert audit log.
import { useCallback, useMemo, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import type {
  BloodReportAnalysis,
  UseBloodReportAnalysisOptions,
  UseBloodReportAnalysisReturn,
} from './blood-report-types';
import { writeAuditLog } from '../lib/firestore-service';
import type { ComplianceMetadata } from '../lib/firestore-service';

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const TIMEOUT_MS    = 30_000;

/** Default compliance metadata — override per organisation */
const DEFAULT_COMPLIANCE: ComplianceMetadata = {
  consentVersion:  'v1.0',
  processingBasis: 'consent',
  dataResidency:   'in',           // India — change to 'eu' / 'us' as needed
  retentionPolicy: 'standard_7yr',
  isAnonymised:    false,
};

// ─────────────────────────────────────────────────────────────────────────────
//  Phase 4 Pillar C — Smart Alerting types
// ─────────────────────────────────────────────────────────────────────────────

/** Alert severity levels for critical scan detections */
export type AlertLevel = 'CRITICAL' | 'HIGH';

/** A critical alert produced by criticalScanDetector */
export interface CriticalAlert {
  level:     AlertLevel;
  scanId?:   string;
  reasons:   string[];   // human-readable trigger list
  timestamp: string;     // ISO
}

/** Minimal scan shape needed by criticalScanDetector */
export interface ScanForAlert {
  id?:              string;
  blastProbability: number;
  wbc?:             number;   // ×10³/μL
  platelets?:       number;   // ×10³/μL
}

/** Payload delivered to push notification and SMS */
interface AlertPayload {
  scanId:    string | undefined;
  level:     AlertLevel;
  reasons:   string[];
  timestamp: string;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
//  criticalScanDetector
//  Returns a CriticalAlert if any threshold is breached, or null if all clear.
//  Thresholds (per Phase 4 spec):
//    blastProbability > 0.8  → CRITICAL
//    blastProbability > 0.6  → HIGH
//    WBC > 30 or WBC < 2     → CRITICAL
//    platelets < 50          → CRITICAL
// ─────────────────────────────────────────────────────────────────────────────

export function criticalScanDetector(scan: ScanForAlert): CriticalAlert | null {
  const reasons: string[] = [];
  let level: AlertLevel | null = null;

  // ── Blast probability thresholds ─────────────────────────────────────────
  if (scan.blastProbability > 0.8) {
    reasons.push(`Blast probability ${(scan.blastProbability * 100).toFixed(1)}% exceeds CRITICAL threshold (>80%)`);
    level = 'CRITICAL';
  } else if (scan.blastProbability > 0.6) {
    reasons.push(`Blast probability ${(scan.blastProbability * 100).toFixed(1)}% exceeds HIGH threshold (>60%)`);
    if (level === null) level = 'HIGH';
  }

  // ── WBC thresholds ────────────────────────────────────────────────────────
  if (scan.wbc !== undefined) {
    if (scan.wbc > 30) {
      reasons.push(`WBC ${scan.wbc.toFixed(1)} ×10³/μL (>30 — leukocytosis)`);
      level = 'CRITICAL';
    } else if (scan.wbc < 2) {
      reasons.push(`WBC ${scan.wbc.toFixed(1)} ×10³/μL (<2 — severe leukopenia)`);
      level = 'CRITICAL';
    }
  }

  // ── Platelet threshold ────────────────────────────────────────────────────
  if (scan.platelets !== undefined && scan.platelets < 50) {
    reasons.push(`Platelets ${scan.platelets.toFixed(0)} ×10³/μL (<50 — severe thrombocytopenia)`);
    level = 'CRITICAL';
  }

  if (level === null || reasons.length === 0) return null;

  return {
    level,
    scanId:    scan.id,
    reasons,
    timestamp: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  dispatchCriticalPushNotification
//  Schedules an immediate local Expo push notification for the alerting doctor.
// ─────────────────────────────────────────────────────────────────────────────

async function dispatchCriticalPushNotification(
  alert: CriticalAlert,
): Promise<void> {
  try {
    // Request permission if not already granted (no-op if already granted)
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      console.warn('HEMO-EDGE: Push notification permission not granted — skipping alert.');
      return;
    }

    const payload: AlertPayload = {
      scanId:    alert.scanId,
      level:     alert.level,
      reasons:   alert.reasons,
      timestamp: alert.timestamp,
    };

    await Notifications.scheduleNotificationAsync({
      content: {
        title: alert.level === 'CRITICAL'
          ? '🚨 CRITICAL — Hemo-Edge Alert'
          : '⚠️ HIGH — Hemo-Edge Alert',
        body: alert.reasons[0] ?? 'Abnormal scan values detected.',
        data: payload,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.MAX,
      },
      trigger: null, // immediate
    });

    console.log(`HEMO-EDGE: Push notification dispatched — level=${alert.level} scanId=${alert.scanId}`);
  } catch (err: unknown) {
    // Notification failure must NEVER crash the clinical workflow
    console.error('HEMO-EDGE: dispatchCriticalPushNotification ->', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  sendCriticalSMSAlert  (Twilio stub)
//  In production: replace console.log with Twilio REST API call via a
//  Cloud Function — never call Twilio directly from the client (exposes
//  Account SID / Auth Token).
//
//  Example Cloud Function endpoint: POST /sendCriticalSMS
//  Body: { to: doctorPhone, alertPayload }
// ─────────────────────────────────────────────────────────────────────────────

export async function sendCriticalSMSAlert(
  doctorPhone: string,
  alertPayload: AlertPayload,
): Promise<void> {
  // TODO: Replace stub with Cloud Function call:
  //
  // await fetch('https://<region>-<project>.cloudfunctions.net/sendCriticalSMS', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ to: doctorPhone, alertPayload }),
  // });
  //
  // The Cloud Function should use:
  //   const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  //   await twilio.messages.create({
  //     body: `[HEMO-EDGE ${alertPayload.level}] ${alertPayload.reasons[0]} — Scan: ${alertPayload.scanId}`,
  //     from: process.env.TWILIO_PHONE_NUMBER,
  //     to: doctorPhone,
  //   });

  console.log(
    `HEMO-EDGE: [TWILIO STUB] SMS to ${doctorPhone}:`,
    `[${alertPayload.level}] ${alertPayload.reasons.join('; ')}`,
    `scanId=${alertPayload.scanId ?? 'unknown'}`,
    `ts=${alertPayload.timestamp}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  handleCriticalAlert  (orchestrates notification + SMS + audit log)
// ─────────────────────────────────────────────────────────────────────────────

async function handleCriticalAlert(
  alert: CriticalAlert,
  actorUid: string,
  actorRole: 'doctor' | 'patient',
  doctorPhone?: string,
): Promise<void> {
  const payload: AlertPayload = {
    scanId:    alert.scanId,
    level:     alert.level,
    reasons:   alert.reasons,
    timestamp: alert.timestamp,
  };

  // Fire push + SMS concurrently; audit log after both settle
  await Promise.allSettled([
    dispatchCriticalPushNotification(alert),
    doctorPhone ? sendCriticalSMSAlert(doctorPhone, payload) : Promise.resolve(),
  ]);

  // Audit: alert dispatched
  await writeAuditLog({
    actorUid,
    actorRole,
    action:       'create_scan',   // closest existing action; extend AuditLogEntry.action for 'critical_alert_dispatched' in production
    resourceId:   alert.scanId,
    resourceType: 'scan',
  });

  console.log(`HEMO-EDGE: Critical alert handled — level=${alert.level}`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  System prompt
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `
You are Hemo-Edge AI, an expert haematology and clinical-pathology assistant
embedded inside a medical diagnostic application. Your sole job is to analyse
blood test reports provided by the user and return a structured JSON response.

OUTPUT RULES (non-negotiable):
1. Return ONLY a single valid JSON object — no markdown, no code fences, no
   prose before or after.
2. The JSON must exactly match this TypeScript interface:

{
  analysisId:          string,
  analyzedOn:          string,
  modelUsed:           string,
  markers: Array<{
    name:           string,
    value:          string,
    unit:           string,
    referenceRange: string,
    status:         "normal" | "low" | "high" | "borderline"
  }>,
  predictedConditions: Array<{
    condition:   string,
    likelihood:  "possible" | "probable" | "highly likely",
    explanation: string,
    icdCode?:    string
  }>,
  overallRisk:         "low" | "moderate" | "high" | "critical",
  summary:             string,
  recommendations:     string[],
  urgency:             "routine" | "soon" | "urgent" | "emergency",
  disclaimer:          string
}

3. Extract every blood marker you can identify from the report.
4. Predict conditions based on the combination of abnormal markers.
5. Set overallRisk / urgency conservatively — err on the side of caution.
6. recommendations should be ordered: most important first.
7. Always set disclaimer to:
   "This analysis is generated by an AI model for informational purposes only.
    It is not a substitute for professional medical advice, diagnosis, or treatment.
    Please consult a licensed haematologist or physician before making any health decisions."
8. If the input is not a recognisable blood report, return:
   markers=[], predictedConditions=[], overallRisk="low",
   summary="The provided text does not appear to be a blood report.",
   recommendations=["Please upload a valid blood test report."],
   urgency="routine".
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
//  Helper — call Groq with timeout + detailed error messages
// ─────────────────────────────────────────────────────────────────────────────

async function callGroq(
  apiKey: string,
  model: string,
  reportText: string,
): Promise<BloodReportAnalysis> {

  const trimmedKey = apiKey?.trim() ?? '';
  if (!trimmedKey) {
    throw new Error(
      'Groq API key is missing.\n\n' +
      'Fix: Add  EXPO_PUBLIC_GROQ_API_KEY=gsk_...  to your .env file, ' +
      'then stop and restart Expo (npx expo start --clear).',
    );
  }
  if (!trimmedKey.startsWith('gsk_')) {
    console.warn('HEMO-EDGE: API key does not start with "gsk_" — may be invalid.');
  }

  console.log(`HEMO-EDGE: -> Groq  model=${model}  key=${trimmedKey.slice(0, 10)}...`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(GROQ_CHAT_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trimmedKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Analyse the following blood test report and return the JSON:\n\n${reportText}`,
          },
        ],
      }),
    });
  } catch (fetchErr: unknown) {
    clearTimeout(timer);
    const fe = fetchErr as { name?: string; message?: string };
    if (fe?.name === 'AbortError') {
      throw new Error(
        `Groq request timed out after ${TIMEOUT_MS / 1000}s.\n` +
        'Check your internet connection and try again.',
      );
    }
    throw new Error(
      `Network error reaching Groq: ${fe?.message ?? String(fetchErr)}\n\n` +
      'Make sure the device has internet access.',
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error('HEMO-EDGE: Groq HTTP', response.status, body.slice(0, 300));

    switch (response.status) {
      case 401:
        throw new Error(
          'Groq API key rejected (401 Unauthorized).\n' +
          'Check EXPO_PUBLIC_GROQ_API_KEY in your .env and restart Expo.',
        );
      case 429:
        throw new Error('Groq rate limit reached (429). Wait a moment and try again.');
      case 400:
        throw new Error(
          `Groq bad request (400): ${body.slice(0, 200)}\n` +
          'The model name may be wrong.',
        );
      default:
        throw new Error(`Groq API error ${response.status}: ${body.slice(0, 200)}`);
    }
  }

  const data = await response.json();
  const rawContent: string = data?.choices?.[0]?.message?.content ?? '';

  if (!rawContent) {
    throw new Error('Groq returned an empty response. Please try again.');
  }

  console.log('HEMO-EDGE: <- Groq raw response length:', rawContent.length);

  const cleaned = rawContent
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: BloodReportAnalysis;
  try {
    parsed = JSON.parse(cleaned) as BloodReportAnalysis;
  } catch {
    console.error('HEMO-EDGE: JSON parse failed. Raw preview:', cleaned.slice(0, 300));
    throw new Error(
      `Groq response was not valid JSON.\nPreview: ${cleaned.slice(0, 100)}`,
    );
  }

  parsed.analysisId          ??= `BA-${Math.floor(10000 + Math.random() * 90000)}`;
  parsed.analyzedOn          ??= new Date().toISOString();
  parsed.modelUsed           ??= model;
  parsed.markers             ??= [];
  parsed.predictedConditions ??= [];
  parsed.overallRisk         ??= 'low';
  parsed.summary             ??= '';
  parsed.recommendations     ??= [];
  parsed.urgency             ??= 'routine';
  parsed.disclaimer          ??=
    'This analysis is for informational purposes only. Consult a licensed physician.';

  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useBloodReportAnalysis
 *
 * Phase 3: Auto-writes HIPAA audit log on every analysis run.
 * Phase 4: Runs criticalScanDetector after every analysis and dispatches
 *   Expo push notification + Twilio SMS stub if thresholds are breached.
 *
 * @example
 * const { analyzeReport, isAnalyzing, result, error, complianceMeta } = useBloodReportAnalysis({
 *   groqApiKey: process.env.EXPO_PUBLIC_GROQ_API_KEY ?? '',
 *   actorUid:   user.uid,
 *   actorRole:  role,
 *   compliance: { dataResidency: 'in', consentVersion: 'v1.2' },
 *   doctorPhone: '+919876543210',   // optional — enables SMS alerts
 * });
 * await analyzeReport(ocrText);
 */
export function useBloodReportAnalysis(
  options: UseBloodReportAnalysisOptions & {
    actorUid?:   string;
    actorRole?:  'doctor' | 'patient';
    compliance?: Partial<ComplianceMetadata>;
    /** Optional doctor phone for Twilio SMS alerts (E.164 format) */
    doctorPhone?: string;
  },
): UseBloodReportAnalysisReturn & {
  complianceMeta: ComplianceMetadata;
  /** Last critical alert produced, or null */
  lastAlert: CriticalAlert | null;
} {
  const {
    groqApiKey,
    model      = DEFAULT_MODEL,
    actorUid,
    actorRole  = 'doctor',
    compliance = {},
    doctorPhone,
  } = options;

  const complianceMeta: ComplianceMetadata = useMemo(() => ({
    ...DEFAULT_COMPLIANCE,
    ...compliance,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [compliance?.consentVersion, compliance?.dataResidency, compliance?.processingBasis,
       compliance?.retentionPolicy, compliance?.isAnonymised]);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result,      setResult]      = useState<BloodReportAnalysis | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [lastAlert,   setLastAlert]   = useState<CriticalAlert | null>(null);

  const mountedRef = useRef(true);
  mountedRef.current = true;

  const analyzeReport = useCallback(
    async (reportText: string): Promise<BloodReportAnalysis> => {
      if (!reportText?.trim()) {
        const msg = 'No report text provided.';
        setError(msg);
        throw new Error(msg);
      }

      setIsAnalyzing(true);
      setError(null);

      // ── Phase 3: Audit log — analysis initiated ──────────────────────────
      if (actorUid) {
        await writeAuditLog({
          actorUid,
          actorRole,
          action:       'create_scan',
          resourceType: 'scan',
          dataResidency:   complianceMeta.dataResidency,
          consentVersion:  complianceMeta.consentVersion,
        });
      }

      try {
        const analysis = await callGroq(groqApiKey, model, reportText);

        if (mountedRef.current) setResult(analysis);

        console.log(
          `HEMO-EDGE: Analysis done. risk=${analysis.overallRisk} ` +
          `conditions=${analysis.predictedConditions.length} ` +
          `markers=${analysis.markers.length}`,
        );

        // ── Phase 4 Pillar C: Critical alert detection ───────────────────
        // Build a ScanForAlert from the Groq analysis markers
        const wbcMarker = analysis.markers.find(m =>
          m.name.toLowerCase().includes('wbc') ||
          m.name.toLowerCase().includes('white blood'),
        );
        const plateletsMarker = analysis.markers.find(m =>
          m.name.toLowerCase().includes('platelet'),
        );

        // Extract numeric value from marker strings like "4.5" or "4.5 ×10³/μL"
        const parseMarkerValue = (v: string): number => parseFloat(v.replace(/[^0-9.]/g, ''));

        const scanForAlert: ScanForAlert = {
          blastProbability: 0, // Groq analysis doesn't include blast probability; caller can pass via options if needed
          wbc:      wbcMarker      ? parseMarkerValue(wbcMarker.value)      : undefined,
          platelets: plateletsMarker ? parseMarkerValue(plateletsMarker.value) : undefined,
        };

        // Allow caller to inject blastProbability via a marker named 'blastProbability'
        const bpMarker = analysis.markers.find(m => m.name.toLowerCase() === 'blastprobability');
        if (bpMarker) scanForAlert.blastProbability = parseMarkerValue(bpMarker.value) / 100;

        const alert = criticalScanDetector(scanForAlert);
        if (alert && actorUid) {
          if (mountedRef.current) setLastAlert(alert);
          // Fire-and-forget: don't block the return of analysis results
          handleCriticalAlert(alert, actorUid, actorRole, doctorPhone).catch(e =>
            console.error('HEMO-EDGE: handleCriticalAlert ->', e),
          );
        }

        return analysis;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('HEMO-EDGE: analyzeReport failed ->', msg);
        if (mountedRef.current) setError(msg);
        throw err;
      } finally {
        if (mountedRef.current) setIsAnalyzing(false);
      }
    },
    [groqApiKey, model, actorUid, actorRole, complianceMeta, doctorPhone],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setIsAnalyzing(false);
    setLastAlert(null);
  }, []);

  return { analyzeReport, isAnalyzing, result, error, reset, complianceMeta, lastAlert };
}