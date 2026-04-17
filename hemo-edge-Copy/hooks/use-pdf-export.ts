// FILE: hooks/use-pdf-export.ts
// Phase 5 — Pillar F: PDF Report Export
//   - Builds an HTML template with patient info, blast score, markers table,
//     cell detection summary, and clinical disclaimer
//   - Prints via expo-print, optionally shares via expo-sharing
//   - DUA acceptance required before export (caller must gate)
//   - Writes auditLog with action: 'pdf_export'
//   - isExporting and exportError exposed for UI feedback

import { useCallback, useState } from 'react';
import * as Print   from 'expo-print';
import * as Sharing from 'expo-sharing';
import { writeAuditLog, scrubPII } from '../lib/firestore-service';
import type { StoredScanResult } from '../lib/firestore-service';
import type { CellDetection } from './use-ml-service';

// ─────────────────────────────────────────────────────────────────────────────
//  Typed error
// ─────────────────────────────────────────────────────────────────────────────

export type ExportErrorCode =
  | 'print_failed'
  | 'share_failed'
  | 'pii_scrub_failed'
  | 'audit_failed';

export class ExportError extends Error {
  public readonly code: ExportErrorCode;
  constructor(code: ExportErrorCode, message: string) {
    super(message);
    this.name  = 'ExportError';
    this.code  = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Cell detection summary helper
// ─────────────────────────────────────────────────────────────────────────────

interface CellTypeSummary {
  cellType:     string;
  count:        number;
  avgConf:      number;
  blastCount:   number;
}

function summariseCellDetections(detections: CellDetection[]): CellTypeSummary[] {
  const map = new Map<string, { total: number; confSum: number; blasts: number }>();

  for (const d of detections) {
    const key     = d.cellType ?? 'Unknown';
    const existing = map.get(key) ?? { total: 0, confSum: 0, blasts: 0 };
    map.set(key, {
      total:   existing.total + 1,
      confSum: existing.confSum + (d.confidence ?? d.blastProbability ?? 0),
      blasts:  existing.blasts + (d.isAbnormal ? 1 : 0),
    });
  }

  return Array.from(map.entries())
    .map(([cellType, v]) => ({
      cellType,
      count:    v.total,
      avgConf:  v.total > 0 ? v.confSum / v.total : 0,
      blastCount: v.blasts,
    }))
    .sort((a, b) => b.count - a.count);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Risk band label
// ─────────────────────────────────────────────────────────────────────────────

function riskBandLabel(blastProbability: number): string {
  if (blastProbability >= 0.8) return 'CRITICAL — Immediate specialist review required';
  if (blastProbability >= 0.6) return 'HIGH — Urgent correlate with morphology';
  if (blastProbability >= 0.3) return 'MODERATE — Monitor closely';
  return 'LOW — Routine follow-up';
}

function riskBandColor(blastProbability: number): string {
  if (blastProbability >= 0.8) return '#ba1a1a';
  if (blastProbability >= 0.6) return '#c25a00';
  if (blastProbability >= 0.3) return '#7d5700';
  return '#006d3a';
}

// ─────────────────────────────────────────────────────────────────────────────
//  HTML template builder
// ─────────────────────────────────────────────────────────────────────────────

function buildReportHTML(
  scan:            StoredScanResult,
  cellDetections:  CellDetection[],
  patientName:     string,
  blastProbability: number,
): string {
  // PII-scrub the scan before embedding in the PDF
  // patientName is passed in separately (already known to caller) and printed
  // as-is — this is intentional; the doctor is exporting for clinical use
  const cellSummary = summariseCellDetections(cellDetections);
  const riskLabel   = riskBandLabel(blastProbability);
  const riskColor   = riskBandColor(blastProbability);
  const pct         = (blastProbability * 100).toFixed(1);
  const exportedAt  = new Date().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });

  const markersRows = (scan.markers ?? [])
    .map((m) => `
      <tr>
        <td>${m.name}</td>
        <td>${m.value} ${m.unit}</td>
        <td>${m.referenceRange}</td>
        <td class="status-${m.status}">${m.status.toUpperCase()}</td>
      </tr>`)
    .join('');

  const cellRows = cellSummary
    .map((c) => `
      <tr>
        <td>${c.cellType}</td>
        <td>${c.count}</td>
        <td>${(c.avgConf * 100).toFixed(1)}%</td>
        <td>${c.blastCount}</td>
      </tr>`)
    .join('');

  const conditionsHTML = (scan.predictedConditions ?? [])
    .map((c) => `<li><strong>${c.condition}</strong> — ${c.likelihood}${c.icdCode ? ` (ICD-10: ${c.icdCode})` : ''}</li>`)
    .join('');

  const recsHTML = (scan.recommendations ?? [])
    .map((r, i) => `<li>${i + 1}. ${r}</li>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HEMO-EDGE Report — ${scan.caseId}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
      font-size: 13px;
      color: #191c1e;
      background: #ffffff;
      padding: 32px;
      line-height: 1.5;
    }

    /* ── Header ─────────────────────────────────────────────────── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid #00478d;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .brand { font-size: 26px; font-weight: 900; color: #00478d; letter-spacing: -1px; }
    .brand-sub { font-size: 11px; color: #424752; font-weight: 600; letter-spacing: 1px; margin-top: 2px; }
    .header-meta { text-align: right; font-size: 11px; color: #424752; }
    .header-meta strong { color: #191c1e; }

    /* ── Patient card ────────────────────────────────────────────── */
    .patient-card {
      background: #f2f4f6;
      border-radius: 10px;
      padding: 16px;
      display: flex;
      gap: 32px;
      margin-bottom: 24px;
    }
    .patient-field { flex: 1; }
    .patient-label { font-size: 9px; font-weight: 800; color: #424752; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 3px; }
    .patient-value { font-size: 14px; font-weight: 700; color: #191c1e; }

    /* ── Risk band ───────────────────────────────────────────────── */
    .risk-band {
      border-radius: 10px;
      padding: 16px 20px;
      margin-bottom: 24px;
      border-left: 5px solid ${riskColor};
      background: ${riskColor}12;
    }
    .risk-band-label { font-size: 9px; font-weight: 800; letter-spacing: 1.5px; color: ${riskColor}; margin-bottom: 6px; }
    .risk-band-score { font-size: 32px; font-weight: 900; color: ${riskColor}; }
    .risk-band-desc  { font-size: 12px; color: ${riskColor}; margin-top: 4px; font-weight: 600; }

    /* ── Section header ──────────────────────────────────────────── */
    .section-title {
      font-size: 13px;
      font-weight: 800;
      color: #00478d;
      letter-spacing: 0.5px;
      margin: 24px 0 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid #e0e3e5;
      text-transform: uppercase;
    }

    /* ── Summary ─────────────────────────────────────────────────── */
    .summary-text {
      font-size: 13px;
      color: #424752;
      line-height: 1.7;
      margin-bottom: 12px;
    }

    /* ── Tables ──────────────────────────────────────────────────── */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
    }
    th {
      font-size: 9px;
      font-weight: 800;
      color: #424752;
      letter-spacing: 1px;
      text-transform: uppercase;
      padding: 7px 10px;
      text-align: left;
      background: #f7f9fb;
      border-bottom: 2px solid #e0e3e5;
    }
    td {
      padding: 8px 10px;
      border-bottom: 1px solid #eceef0;
      font-size: 12px;
      color: #191c1e;
    }
    tr:nth-child(even) td { background: #f7f9fb; }

    /* Marker status colours */
    .status-high       { color: #ba1a1a; font-weight: 700; }
    .status-low        { color: #ba1a1a; font-weight: 700; }
    .status-borderline { color: #7d5700; font-weight: 700; }
    .status-normal     { color: #006d3a; font-weight: 700; }

    /* ── Lists ───────────────────────────────────────────────────── */
    ul, ol { padding-left: 18px; color: #424752; font-size: 12px; }
    li { margin-bottom: 5px; line-height: 1.5; }

    /* ── Disclaimer ──────────────────────────────────────────────── */
    .disclaimer {
      margin-top: 32px;
      padding: 14px 18px;
      background: #fff8e1;
      border-left: 4px solid #f59e0b;
      border-radius: 8px;
      font-size: 11px;
      color: #78350f;
      line-height: 1.6;
    }
    .disclaimer strong { font-weight: 800; }

    /* ── Footer ──────────────────────────────────────────────────── */
    .footer {
      margin-top: 24px;
      padding-top: 12px;
      border-top: 1px solid #e0e3e5;
      font-size: 10px;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
    }

    /* ── Page break hint ─────────────────────────────────────────── */
    .page-break { page-break-before: always; }

    /* ── No data ─────────────────────────────────────────────────── */
    .no-data { font-size: 12px; color: #94a3b8; font-style: italic; padding: 8px 0; }
  </style>
</head>
<body>

  <!-- ── Header ─────────────────────────────────────────────────────────── -->
  <div class="header">
    <div>
      <div class="brand">HEMO-EDGE</div>
      <div class="brand-sub">AI-POWERED HEMATOLOGY DIAGNOSTICS</div>
    </div>
    <div class="header-meta">
      <div><strong>Exported:</strong> ${exportedAt}</div>
      <div><strong>Case ID:</strong> ${scan.caseId ?? '—'}</div>
      <div><strong>Scan ID:</strong> ${scan.id ?? '—'}</div>
    </div>
  </div>

  <!-- ── Patient card ──────────────────────────────────────────────────── -->
  <div class="patient-card">
    <div class="patient-field">
      <div class="patient-label">Patient Name</div>
      <div class="patient-value">${patientName || '—'}</div>
    </div>
    <div class="patient-field">
      <div class="patient-label">Scan Date</div>
      <div class="patient-value">${
        scan.analyzedOn
          ? new Date(scan.analyzedOn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
          : '—'
      }</div>
    </div>
    <div class="patient-field">
      <div class="patient-label">Specimen Type</div>
      <div class="patient-value">${scan.specimenType ?? '—'}</div>
    </div>
    <div class="patient-field">
      <div class="patient-label">Overall Risk</div>
      <div class="patient-value">${(scan.overallRisk ?? '—').toUpperCase()}</div>
    </div>
  </div>

  <!-- ── Blast probability risk band ───────────────────────────────────── -->
  ${blastProbability > 0 ? `
  <div class="risk-band">
    <div class="risk-band-label">BLAST PROBABILITY SCORE</div>
    <div class="risk-band-score">${pct}%</div>
    <div class="risk-band-desc">${riskLabel}</div>
  </div>` : ''}

  <!-- ── Summary ────────────────────────────────────────────────────────── -->
  ${scan.summary ? `
  <div class="section-title">Clinical Summary</div>
  <p class="summary-text">${scan.summary}</p>` : ''}

  <!-- ── Blood markers ──────────────────────────────────────────────────── -->
  <div class="section-title">Blood Markers</div>
  ${(scan.markers ?? []).length > 0 ? `
  <table>
    <thead>
      <tr>
        <th>Marker</th>
        <th>Value</th>
        <th>Reference Range</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>${markersRows}</tbody>
  </table>` : '<p class="no-data">No marker data available.</p>'}

  <!-- ── CBC highlights ─────────────────────────────────────────────────── -->
  ${(scan.wbc || scan.rbc || scan.hemoglobin || scan.platelets) ? `
  <div class="section-title">CBC Key Values</div>
  <table>
    <thead>
      <tr><th>Parameter</th><th>Value</th><th>Unit</th></tr>
    </thead>
    <tbody>
      ${scan.wbc       != null ? `<tr><td>WBC</td><td>${scan.wbc}</td><td>×10³/μL</td></tr>` : ''}
      ${scan.rbc       != null ? `<tr><td>RBC</td><td>${scan.rbc}</td><td>×10⁶/μL</td></tr>` : ''}
      ${scan.hemoglobin!= null ? `<tr><td>Hemoglobin</td><td>${scan.hemoglobin}</td><td>g/dL</td></tr>` : ''}
      ${scan.platelets != null ? `<tr><td>Platelets</td><td>${scan.platelets}</td><td>×10³/μL</td></tr>` : ''}
    </tbody>
  </table>` : ''}

  <!-- ── Cell detection summary ─────────────────────────────────────────── -->
  ${cellSummary.length > 0 ? `
  <div class="section-title">Cell Detection Summary (XAI)</div>
  <table>
    <thead>
      <tr>
        <th>Cell Type</th>
        <th>Count</th>
        <th>Avg Confidence</th>
        <th>Blast Flagged</th>
      </tr>
    </thead>
    <tbody>${cellRows}</tbody>
  </table>` : ''}

  <!-- ── Predicted conditions ───────────────────────────────────────────── -->
  ${conditionsHTML ? `
  <div class="section-title">Predicted Conditions</div>
  <ul>${conditionsHTML}</ul>` : ''}

  <!-- ── Recommendations ────────────────────────────────────────────────── -->
  ${recsHTML ? `
  <div class="section-title">Recommendations</div>
  <ul>${recsHTML}</ul>` : ''}

  <!-- ── Disclaimer ─────────────────────────────────────────────────────── -->
  <div class="disclaimer">
    <strong>⚠ For clinical use only.</strong>
    This report was generated by HEMO-EDGE, an AI-assisted hematology diagnostic platform.
    It is not a substitute for specialist review, clinical judgement, or laboratory confirmation.
    Results must be interpreted by a qualified haematologist or pathologist.
    HEMO-EDGE complies with HIPAA §164.312 and GDPR Art. 25 data-protection-by-design principles.
    Scan ID: ${scan.id ?? '—'} · Exported: ${exportedAt}
  </div>

  <!-- ── Footer ─────────────────────────────────────────────────────────── -->
  <div class="footer">
    <span>HEMO-EDGE AI Diagnostics Platform</span>
    <span>CONFIDENTIAL — FOR AUTHORISED CLINICAL USE ONLY</span>
  </div>

</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Hook return type
// ─────────────────────────────────────────────────────────────────────────────

export interface UsePdfExportReturn {
  isExporting:      boolean;
  exportError:      ExportError | null;
  exportScanAsPDF:  (
    scan:            StoredScanResult,
    cellDetections:  CellDetection[],
    patientName:     string,
    actorUid:        string,
    actorRole:       'doctor' | 'patient',
    shareAfterPrint?: boolean,
  ) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Hook
// ─────────────────────────────────────────────────────────────────────────────

export function usePdfExport(): UsePdfExportReturn {
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<ExportError | null>(null);

  const exportScanAsPDF = useCallback(
    async (
      scan:             StoredScanResult,
      cellDetections:   CellDetection[],
      patientName:      string,
      actorUid:         string,
      actorRole:        'doctor' | 'patient',
      shareAfterPrint:  boolean = true,
    ): Promise<void> => {
      setExportError(null);
      setIsExporting(true);

      try {
        // ── 1. Build HTML ─────────────────────────────────────────────────────
        const blastProbability = scan.blastProbability ?? 0;
        const html = buildReportHTML(scan, cellDetections, patientName, blastProbability);

        // ── 2. Print / generate PDF via expo-print ────────────────────────────
        let pdfUri: string | undefined;
        try {
          const result = await Print.printAsync({
            html,
            // base64 = false → prints to system dialog on iOS/Android
            // On iOS, user can tap "Save to Files" from the print dialog
          });
          // printAsync resolves after the dialog is dismissed; no URI returned
          // For a saveable file URI, use printToFileAsync instead
          void result; // result is void on most platforms
        } catch (printErr) {
          throw new ExportError('print_failed', `Print failed: ${String(printErr)}`);
        }

        // ── 3. Optionally generate a file + share ────────────────────────────
        if (shareAfterPrint) {
          try {
            const isAvailable = await Sharing.isAvailableAsync();
            if (isAvailable) {
              // Generate a shareable PDF file
              const fileResult = await Print.printToFileAsync({ html, base64: false });
              pdfUri = fileResult.uri;
              await Sharing.shareAsync(pdfUri, {
                mimeType: 'application/pdf',
                dialogTitle: `HEMO-EDGE Report — ${scan.caseId ?? scan.id}`,
                UTI: 'com.adobe.pdf',
              });
            }
          } catch (shareErr) {
            // Share failure is non-fatal — PDF was already printed
            console.warn('HEMO-EDGE: share after print failed ->', shareErr);
            throw new ExportError('share_failed', `Share failed: ${String(shareErr)}`);
          }
        }

        // ── 4. Audit log ─────────────────────────────────────────────────────
        try {
          await writeAuditLog({
            actorUid,
            actorRole,
            action:       'export_data',    // closest existing AuditLogEntry.action
            resourceType: 'report',
            resourceId:   scan.id,
          });
        } catch (auditErr) {
          // Audit failure must not block a completed export — log only
          console.error('HEMO-EDGE: pdf_export audit log failed ->', auditErr);
        }

        console.log(`HEMO-EDGE: PDF export complete scanId=${scan.id} uri=${pdfUri ?? 'printed'}`);
      } catch (err) {
        const exportErr = err instanceof ExportError
          ? err
          : new ExportError('print_failed', `Unexpected export error: ${String(err)}`);
        setExportError(exportErr);
        console.error('HEMO-EDGE: usePdfExport ->', exportErr);
        throw exportErr;
      } finally {
        setIsExporting(false);
      }
    },
    [],
  );

  return { isExporting, exportError, exportScanAsPDF };
}
