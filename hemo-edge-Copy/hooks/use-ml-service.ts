import { loadTensorflowModel, TensorflowModel } from "react-native-fast-tflite";

const MODELS = {
  cellMorphology: {
    name: "Cell Morphology (Hemo-Edge v2.1)",
    path: require("../assets/models/hemo_edge_quantized.tflite"),
    description: "Real-time blood cell classification and anomaly detection.",
  },
  reportOCR: {
    name: "Lab Report OCR (Hemo-Edge v1.4)",
    path: require("../assets/models/hemo_edge_quantized.tflite"),
    description: "Automated extraction of diagnostic metrics from lab reports.",
  },
};

const SUPPORTED_EXTENSIONS = ['.bmp', '.tif', '.tiff', '.jpg', '.jpeg', '.png', '.pdf'];

export type Severity = 'normal' | 'warning' | 'critical';

// ─── XAI: per-cell bounding box detection ────────────────────────────────────
// Coordinates are normalised to a 0–100 viewBox so they scale to any image size.
export type CellDetection = {
  id:               number;
  x:                number;   // top-left x  (0–100)
  y:                number;   // top-left y  (0–100)
  w:                number;   // box width   (0–100)
  h:                number;   // box height  (0–100)
  cellType:         'RBC' | 'WBC' | 'Blast' | 'Platelet' | 'Unknown';
  blastProbability: number;   // 0–1 raw classifier score for this cell
  isAbnormal:       boolean;  // true when blastProbability > 0.5
};

export type InferenceResult = {
  // ── Core identification ──────────────────────────────────────
  caseId:             string;
  analyzedOn:         string;   // ISO date string
  processingLatency:  string;   // e.g. "1.2s"

  // ── Classification output ────────────────────────────────────
  confidence:   number;         // 0–100
  detections:   string[];       // detected cell types / markers
  diagnosis:    string;         // human-readable finding
  severity:     Severity;       // 'normal' | 'warning' | 'critical'
  cellCount:    number;

  // ── XAI fields ───────────────────────────────────────────────
  blastProbability:  number;          // 0–1 slide-level blast score
  confidenceMargin:  number;          // |blastProbability - 0.5| — distance from decision boundary
  blastCellPercent:  number;          // % of detected cells classified as blast
  cellDetections:    CellDetection[]; // per-cell bounding boxes with individual scores

  // ── File metadata ────────────────────────────────────────────
  fileUri:      string;
  fileName:     string;
  fileType:     string;
  specimenType: string;
};

// ─── Seeded XAI stub generator ────────────────────────────────────────────────
// Produces deterministic, per-case bounding boxes and blast probabilities so the
// UI pipeline can be fully exercised end-to-end before real model output is wired
// in. Replace this entire function body with your real model output parser.
function generateXAIStub(
  caseId: string,
  severity: Severity,
): {
  blastProbability: number;
  confidenceMargin: number;
  blastCellPercent: number;
  cellDetections:   CellDetection[];
} {
  // ── Deterministic PRNG seeded by caseId ─────────────────────────────────────
  let h = 0;
  for (let i = 0; i < caseId.length; i++) {
    h = (Math.imul(31, h) + caseId.charCodeAt(i)) | 0;
  }
  const rand = () => {
    h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) | 0;
    h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) | 0;
    return (h >>> 0) / 0xffffffff;
  };

  // ── Slide-level blast probability ────────────────────────────────────────────
  const blastProbability =
    severity === 'critical' ? 0.72 + rand() * 0.24
    : severity === 'warning' ? 0.42 + rand() * 0.15
    : 0.04 + rand() * 0.18;

  const confidenceMargin = Math.abs(blastProbability - 0.5);

  const blastCellPercent =
    severity === 'critical' ? 28 + rand() * 42
    : severity === 'warning' ? 8 + rand() * 22
    : rand() * 7;

  // ── Per-cell detections ──────────────────────────────────────────────────────
  const numCells = Math.floor(6 + rand() * 12); // 6–18 cells

  const cellDetections: CellDetection[] = Array.from({ length: numCells }, (_, i) => {
    const size = 7 + rand() * 11;
    const x    = 4 + rand() * (90 - size);
    const y    = 4 + rand() * (90 - size);

    // Per-cell blast probability — correlated with severity but with individual variance
    const cellProb =
      severity === 'critical' && rand() > 0.38 ? 0.58 + rand() * 0.38
      : severity === 'warning'  && rand() > 0.52 ? 0.44 + rand() * 0.22
      : rand() * 0.44;

    const isAbnormal = cellProb > 0.5;

    let cellType: CellDetection['cellType'];
    if (isAbnormal)        cellType = 'Blast';
    else if (rand() > 0.35) cellType = 'RBC';
    else if (rand() > 0.5)  cellType = 'WBC';
    else                    cellType = 'Platelet';

    return { id: i, x, y, w: size, h: size, cellType, blastProbability: cellProb, isAbnormal };
  });

  return { blastProbability, confidenceMargin, blastCellPercent, cellDetections };
}

class MLService {
  private cellModel: TensorflowModel | null = null;
  private ocrModel:  TensorflowModel | null = null;
  private isInitializing = false;

  async initialize() {
    if (this.isInitializing || (this.cellModel && this.ocrModel)) return;
    this.isInitializing = true;
    console.log("HEMO-EDGE: Initializing ML Models...");
    try {
      this.cellModel = await loadTensorflowModel(MODELS.cellMorphology.path);
      console.log("HEMO-EDGE: Cell Morphology Model Loaded.");
      this.ocrModel  = await loadTensorflowModel(MODELS.reportOCR.path);
      console.log("HEMO-EDGE: Report OCR Model Loaded.");
    } catch (error) {
      console.error("HEMO-EDGE: Failed to load ML models:", error);
    } finally {
      this.isInitializing = false;
    }
  }

  validateFile(uri: string, mimeType?: string | null): { valid: boolean; reason?: string } {
    if (!uri) return { valid: false, reason: 'No file URI provided.' };

    const supportedMimes = [
      'image/bmp', 'image/x-bmp', 'image/x-ms-bmp',
      'image/tiff', 'image/tif', 'image/x-tiff',
      'image/jpeg', 'image/jpg', 'image/png',
      'application/pdf',
    ];
    if (mimeType && supportedMimes.includes(mimeType.toLowerCase())) {
      return { valid: true };
    }

    const lower = uri.toLowerCase().split('?')[0];
    const hasValidExt = SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext));
    if (hasValidExt) return { valid: true };

    if (!mimeType || mimeType === 'application/octet-stream') {
      console.warn('HEMO-EDGE: Unknown file type, attempting inference anyway:', uri);
      return { valid: true };
    }

    return {
      valid: false,
      reason: `Unsupported file type: ${mimeType}. Please use BMP, TIFF, JPEG, PNG, or PDF.`,
    };
  }

  async runInference(
    modelType: 'cell' | 'ocr',
    inputData: { imageUri: string; mimeType?: string | null; fileName?: string },
  ): Promise<InferenceResult> {
    const { imageUri, mimeType, fileName = 'unknown' } = inputData;

    // ── 1. Validate file type ─────────────────────────────────────────────────
    const validation = this.validateFile(imageUri, mimeType);
    if (!validation.valid) {
      throw new Error(validation.reason ?? 'Unsupported file type.');
    }

    // ── 2. Ensure model is loaded ─────────────────────────────────────────────
    const model = modelType === 'cell' ? this.cellModel : this.ocrModel;
    if (!model) {
      await this.initialize();
      const retried = modelType === 'cell' ? this.cellModel : this.ocrModel;
      if (!retried) {
        throw new Error(
          `${modelType === 'cell' ? 'Cell morphology' : 'OCR'} model failed to load. ` +
          'Ensure hemo_edge_quantized.tflite is in assets/models/ and re-build the app.',
        );
      }
    }

    // ── 3. Run inference ──────────────────────────────────────────────────────
    // TODO: Replace the stub below with real TFLite preprocessing + model.run([tensor]).
    //
    // Real flow example:
    //   const imageData = await FileSystem.readAsStringAsync(imageUri, { encoding: 'base64' });
    //   const tensor    = preprocessImage(imageData); // resize → normalise → Float32Array
    //   const [output]  = await model.run([tensor]);
    //   const parsed    = parseModelOutput(output);   // maps logits → severity/diagnosis
    //   const xai       = parseXAIOutput(output);     // maps output → CellDetection[]
    //
    // Until then, this stub simulates a realistic result so the full UI pipeline works
    // end-to-end and developers can verify screens, navigation, and param passing.

    console.log(`HEMO-EDGE: Running ${modelType} inference on: ${imageUri}`);
    const startMs = Date.now();
    await new Promise(resolve => setTimeout(resolve, 1200));
    const latencyMs = Date.now() - startMs;

    // ── Detect file type for labelling ────────────────────────────────────────
    const lower = (mimeType ?? imageUri).toLowerCase();
    const isBmp  = lower.includes('bmp');
    const isTiff = lower.includes('tif');
    const isPdf  = lower.includes('pdf');
    const fileType = isBmp ? 'BMP' : isTiff ? 'TIFF' : isPdf ? 'PDF' : 'Image';

    // ── Stub classification result ────────────────────────────────────────────
    const stubResults: Array<{
      confidence: number;
      detections: string[];
      diagnosis:  string;
      severity:   Severity;
      cellCount:  number;
    }> = [
      {
        confidence: 94.7,
        detections: ['Abnormal RBC Morphology', 'Sickle Cells', 'Hypochromic Cells'],
        diagnosis:
          'Significant sickle-cell morphology detected with hypochromic micro-cytic pattern. ' +
          'Immediate haematologist review recommended.',
        severity: 'critical',
        cellCount: 3847,
      },
      {
        confidence: 87.2,
        detections: ['Mild Anisocytosis', 'Borderline Thrombocytopenia'],
        diagnosis:
          'Mild variation in RBC size observed. Platelet count borderline low. ' +
          'Repeat CBC in 48 hours advised.',
        severity: 'warning',
        cellCount: 5210,
      },
      {
        confidence: 98.1,
        detections: ['Normal RBC', 'Normal WBC', 'Adequate Platelets'],
        diagnosis: 'All cell populations within normal reference ranges. No morphological anomalies detected.',
        severity: 'normal',
        cellCount: 6032,
      },
    ];

    const idx = fileName.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % stubResults.length;
    const classification = stubResults[idx];

    const caseId = `HE-${Math.floor(10000 + Math.random() * 90000)}`;

    // ── Generate XAI data ─────────────────────────────────────────────────────
    // REPLACE generateXAIStub() with your real model's bounding-box output parser.
    const xai = generateXAIStub(caseId, classification.severity);

    return {
      caseId,
      analyzedOn:        new Date().toISOString(),
      processingLatency: `${(latencyMs / 1000).toFixed(1)}s`,

      confidence:  classification.confidence,
      detections:  classification.detections,
      diagnosis:   classification.diagnosis,
      severity:    classification.severity,
      cellCount:   classification.cellCount,

      // XAI fields
      blastProbability: xai.blastProbability,
      confidenceMargin: xai.confidenceMargin,
      blastCellPercent: xai.blastCellPercent,
      cellDetections:   xai.cellDetections,

      fileUri:      imageUri,
      fileName,
      fileType,
      specimenType: modelType === 'cell' ? 'Peripheral Blood' : 'Lab Report',
    };
  }

  getStatus() {
    return {
      cellLoaded:     !!this.cellModel,
      ocrLoaded:      !!this.ocrModel,
      isInitializing: this.isInitializing,
    };
  }
}

export const mlService = new MLService();