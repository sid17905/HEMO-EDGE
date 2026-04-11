// ─────────────────────────────────────────────────────────────────────────────
//  Blood Report Analysis – Shared Types
//  Compatible with your existing InferenceResult shape from use-ml-service.ts
// ─────────────────────────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'moderate' | 'high' | 'critical';

export interface BloodMarker {
  name: string;          // e.g. "Haemoglobin"
  value: string;         // e.g. "9.2"
  unit: string;          // e.g. "g/dL"
  referenceRange: string;// e.g. "13.5–17.5"
  status: 'normal' | 'low' | 'high' | 'borderline';
}

export interface PredictedCondition {
  condition: string;           // e.g. "Iron-Deficiency Anaemia"
  likelihood: 'possible' | 'probable' | 'highly likely';
  explanation: string;         // 1–2 sentence rationale
  icdCode?: string;            // e.g. "D50.9" (informational only)
}

export interface BloodReportAnalysis {
  // ── Metadata ─────────────────────────────────────────────
  analysisId:    string;
  analyzedOn:    string;         // ISO date
  modelUsed:     string;         // Groq model id

  // ── Parsed markers ───────────────────────────────────────
  markers:       BloodMarker[];

  // ── Predictions ──────────────────────────────────────────
  predictedConditions: PredictedCondition[];
  overallRisk:         RiskLevel;
  summary:             string;   // 2–3 sentence plain-English summary

  // ── Actionable advice ────────────────────────────────────
  recommendations: string[];     // ordered list of next steps
  urgency:         'routine' | 'soon' | 'urgent' | 'emergency';

  // ── Disclaimer ───────────────────────────────────────────
  disclaimer: string;
}

export interface UseBloodReportAnalysisOptions {
  /** Groq API key – store in SecureStore / env, never hard-code */
  groqApiKey: string;
  /**
   * Groq model to use.
   * Defaults to 'llama3-70b-8192' — the best free-tier model for medical reasoning.
   * Other good options: 'mixtral-8x7b-32768', 'gemma2-9b-it'
   */
  model?: string;
}

export interface UseBloodReportAnalysisReturn {
  /** Run an analysis.  Pass the raw OCR text or a structured report string. */
  analyzeReport: (reportText: string) => Promise<BloodReportAnalysis>;
  isAnalyzing:   boolean;
  result:        BloodReportAnalysis | null;
  error:         string | null;
  reset:         () => void;
}
