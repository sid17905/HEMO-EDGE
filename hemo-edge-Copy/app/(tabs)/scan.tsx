import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import {
  Microscope, Zap, Image as ImageIcon, X, FileText,
} from 'lucide-react-native';
import { mlService } from '../../hooks/use-ml-service';
import { useBloodReportAnalysis } from '../../hooks/use-blood-report-analysis';

const THEME = {
  primary:       '#00478d',
  secondary:     '#4f5f7b',
  background:    '#f7f9fb',
  surface:       '#ffffff',
  text:          '#191c1e',
  textSecondary: '#424752',
  border:        '#e0e3e5',
  cardBg:        '#f2f4f6',
  blood:         '#c0392b',
};

const { width } = Dimensions.get('window');

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/bmp',
  'image/x-bmp',
  'image/x-ms-bmp',
  'image/tiff',
  'image/tif',
  'image/x-tiff',
  'image/jpeg',
  'image/jpg',
  'image/png',
];

// ─────────────────────────────────────────────────────────────────────────────
//  Pure-JS base64 helpers  (NO Buffer, NO jpeg-js, NO native deps)
// ─────────────────────────────────────────────────────────────────────────────

/** Decode a base64 string to a Uint8Array — works in any JS environment */
function base64ToUint8Array(b64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

  const stripped = b64.replace(/=+$/, '');
  const outputLen = Math.floor((stripped.length * 3) / 4);
  const out = new Uint8Array(outputLen);

  let byteIndex = 0;
  for (let i = 0; i < stripped.length; i += 4) {
    const a = lookup[stripped.charCodeAt(i)];
    const b = lookup[stripped.charCodeAt(i + 1)];
    const c = lookup[stripped.charCodeAt(i + 2)] ?? 0;
    const d = lookup[stripped.charCodeAt(i + 3)] ?? 0;
    out[byteIndex++] = (a << 2) | (b >> 4);
    if (i + 2 < stripped.length) out[byteIndex++] = ((b & 0xf) << 4) | (c >> 2);
    if (i + 3 < stripped.length) out[byteIndex++] = ((c & 0x3) << 6) | d;
  }
  return out.slice(0, byteIndex);
}

/** Encode a Uint8Array to base64 — works in any JS environment */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    result += chars[a >> 2];
    result += chars[((a & 3) << 4) | (b >> 4)];
    result += i + 1 < bytes.length ? chars[((b & 0xf) << 2) | (c >> 6)] : '=';
    result += i + 2 < bytes.length ? chars[c & 0x3f] : '=';
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
//  BMP Encoder  (pure JS — no native deps, no Buffer)
// ─────────────────────────────────────────────────────────────────────────────
function encodeBMP(imgWidth: number, imgHeight: number, rgbData: Uint8Array): Uint8Array {
  const rowStride  = Math.floor((24 * imgWidth + 31) / 32) * 4;
  const pixelBytes = rowStride * imgHeight;
  const fileSize   = 54 + pixelBytes;

  const buf  = new Uint8Array(fileSize);
  const view = new DataView(buf.buffer);

  buf[0] = 0x42; buf[1] = 0x4D;
  view.setUint32(2,  fileSize, true);
  view.setUint32(6,  0,        true);
  view.setUint32(10, 54,       true);

  view.setUint32(14, 40,         true);
  view.setInt32 (18, imgWidth,   true);
  view.setInt32 (22, imgHeight,  true);
  view.setUint16(26, 1,          true);
  view.setUint16(28, 24,         true);
  view.setUint32(30, 0,          true);
  view.setUint32(34, pixelBytes, true);
  view.setInt32 (38, 2835,       true);
  view.setInt32 (42, 2835,       true);
  view.setUint32(46, 0,          true);
  view.setUint32(50, 0,          true);

  let offset = 54;
  for (let row = imgHeight - 1; row >= 0; row--) {
    for (let col = 0; col < imgWidth; col++) {
      const src     = (row * imgWidth + col) * 3;
      buf[offset++] = rgbData[src + 2];
      buf[offset++] = rgbData[src + 1];
      buf[offset++] = rgbData[src + 0];
    }
    const pad = rowStride - imgWidth * 3;
    for (let p = 0; p < pad; p++) buf[offset++] = 0;
  }

  return buf;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Camera → BMP conversion
// ─────────────────────────────────────────────────────────────────────────────
const BMP_INPUT_SIZE = 224;

async function convertCameraToBMP(sourceUri: string): Promise<{ uri: string; mimeType: string }> {
  console.log('[SCAN] convertCameraToBMP → source:', sourceUri);

  const resized = await ImageManipulator.manipulateAsync(
    sourceUri,
    [{ resize: { width: BMP_INPUT_SIZE, height: BMP_INPUT_SIZE } }],
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG, base64: false },
  );

  console.log('[SCAN] Resized JPEG URI:', resized.uri);

  const bmpUri = `${FileSystem.cacheDirectory}scan_${Date.now()}.bmp`;
  await FileSystem.copyAsync({ from: resized.uri, to: bmpUri });

  console.log('[SCAN] BMP file (JPEG payload) written →', bmpUri);
  return { uri: bmpUri, mimeType: 'image/bmp' };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Screen
// ─────────────────────────────────────────────────────────────────────────────
export default function ScanScreen() {
  const { analyzeReport } = useBloodReportAnalysis({
    groqApiKey: process.env.EXPO_PUBLIC_GROQ_API_KEY ?? '',
  });

  const [isCapturing,   setIsCapturing]   = useState(false);
  const [isProcessing,  setIsProcessing]  = useState(false);
  const [processingMsg, setProcessingMsg] = useState('');
  const [flashOn,       setFlashOn]       = useState(false);

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<any>(null);

  useEffect(() => {
    (async () => { await mlService.initialize(); })();
  }, []);

  const ensureCameraPermission = async (): Promise<boolean> => {
    if (permission?.granted) return true;
    const result = await requestPermission();
    if (!result.granted) {
      Alert.alert(
        'Camera Permission Required',
        'Please allow camera access in your device settings.',
        [{ text: 'OK' }],
      );
      return false;
    }
    return true;
  };

  // ── Capture from camera ────────────────────────────────────────────────────
  const handleCapture = async () => {
    if (isCapturing || !cameraRef.current) return;
    if (!(await ensureCameraPermission())) return;
    setIsCapturing(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85, base64: false });

      setIsProcessing(true);
      setProcessingMsg('Converting to BMP…');

      const { uri: bmpUri, mimeType } = await convertCameraToBMP(photo.uri);
      await runInference(bmpUri, mimeType, `scan_${Date.now()}.bmp`);
    } catch (e: any) {
      console.error('[SCAN] Capture failed:', e);
      Alert.alert('Capture Failed', e?.message ?? 'Could not process the image. Please try again.');
      setIsProcessing(false);
      setProcessingMsg('');
    } finally {
      setIsCapturing(false);
    }
  };

  // ── Pick image from gallery ────────────────────────────────────────────────
  const handlePickImage = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ACCEPTED_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      console.log('[SCAN] Picked file:', asset.name, asset.mimeType, asset.uri);

      const isBmp = (asset.mimeType ?? '').includes('bmp') ||
                    asset.name?.toLowerCase().endsWith('.bmp');

      if (isBmp) {
        await runInference(asset.uri, asset.mimeType, asset.name);
      } else {
        setIsProcessing(true);
        setProcessingMsg('Converting to BMP…');
        const { uri: bmpUri, mimeType } = await convertCameraToBMP(asset.uri);
        await runInference(bmpUri, mimeType, `converted_${asset.name ?? 'file'}.bmp`);
      }
    } catch (e: any) {
      console.error('[SCAN] Pick image error:', e);
      Alert.alert('File Error', e?.message ?? 'Could not open the file. Please try again.');
      setIsProcessing(false);
      setProcessingMsg('');
    }
  };

  // ── Run cell-morphology model + Groq LLM ──────────────────────────────────
  const runInference = async (uri: string, mimeType?: string | null, fileName?: string) => {
    setIsProcessing(true);
    try {
      // Step 1: Cell morphology TFLite model
      setProcessingMsg(`Scanning ${fileName ?? 'file'}…`);
      const mlResult = await mlService.runInference('cell', {
        imageUri: uri,
        mimeType,
        fileName,
      });
      console.log('[SCAN] CELL Result:', mlResult);

      // Step 2: Groq LLM disease prediction
      // Blast probability is included so the LLM can factor it into the clinical narrative.
      // A cell at 0.92 blast probability is clinically very different from one at 0.51 —
      // the raw score and confidence margin both appear in the prompt.
      setProcessingMsg('Running AI analysis…');
      const groqReport = await analyzeReport(
        `Patient File: ${mlResult.fileName}
Specimen Type: ${mlResult.specimenType}
File Type: ${mlResult.fileType}
Diagnosis: ${mlResult.diagnosis}
Detections: ${mlResult.detections.join(', ')}
Cell Count: ${mlResult.cellCount}
Severity: ${mlResult.severity}
Confidence: ${mlResult.confidence}%
Case ID: ${mlResult.caseId}

XAI — Explainable AI Output:
Slide-level Blast Probability: ${(mlResult.blastProbability * 100).toFixed(1)}%
Confidence Margin from Decision Boundary: ${(mlResult.confidenceMargin * 100).toFixed(1)}%
Blast Cell Percentage: ${mlResult.blastCellPercent.toFixed(1)}% of detected cells
Total Cells Detected: ${mlResult.cellDetections.length}
Abnormal Cells: ${mlResult.cellDetections.filter(c => c.isAbnormal).length}

Interpret the blast probability carefully — a score above 70% indicates high clinical urgency. Include the blast probability in your risk assessment and recommendations.`
      );
      console.log('[SCAN] Groq Report:', groqReport);

      // Step 3: Navigate to result screen — pass all XAI fields as serialised params
      router.replace({
        pathname: '/result',
        params: {
          groqReport:         JSON.stringify(groqReport),
          caseId:             mlResult.caseId,
          imageUri:           mlResult.fileUri,
          fileName:           mlResult.fileName,
          analyzedOn:         mlResult.analyzedOn,
          processingLatency:  mlResult.processingLatency,
          specimenType:       mlResult.specimenType,
          scanMode:           'Cell Morphology AI',
          source:             'scan',
          // XAI params
          blastProbability:   String(mlResult.blastProbability),
          confidenceMargin:   String(mlResult.confidenceMargin),
          blastCellPercent:   String(mlResult.blastCellPercent),
          cellDetections:     JSON.stringify(mlResult.cellDetections),
        },
      });
    } catch (e: any) {
      console.error('[SCAN] Inference failed:', e);
      Alert.alert(
        'Analysis Failed',
        e?.message ?? 'Could not analyze the slide. Please try again.',
      );
    } finally {
      setIsProcessing(false);
      setProcessingMsg('');
    }
  };

  // ── Processing overlay ─────────────────────────────────────────────────────
  if (isProcessing) {
    return (
      <View style={styles.processingOverlay}>
        <ActivityIndicator color="#ffffff" size="large" />
        <Text style={styles.processingText}>{processingMsg}</Text>
      </View>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        enableTorch={flashOn}
      >
        <SafeAreaView style={styles.cameraTopBar}>
          <TouchableOpacity style={styles.camIconButton} onPress={() => router.replace('/(tabs)')}>
            <X color="#fff" size={24} />
          </TouchableOpacity>

          <View style={[styles.modePill, styles.modePillBlood]}>
            <Microscope color="#fff" size={14} />
            <Text style={styles.modePillText}>BLOOD SAMPLE</Text>
          </View>

          <TouchableOpacity
            style={[styles.camIconButton, flashOn && styles.camIconButtonActive]}
            onPress={() => setFlashOn(!flashOn)}
          >
            <Zap color={flashOn ? THEME.primary : '#fff'} size={24} />
          </TouchableOpacity>
        </SafeAreaView>

        <View style={styles.reticleOverlay}>
          <View style={[styles.reticleCircle, isCapturing && styles.reticleActive]}>
            {isCapturing && <View style={styles.scanLine} />}
          </View>
          <Text style={styles.reticleHint}>
            Center the blood slide within the circle
          </Text>
        </View>

        <View style={styles.cameraControls}>
          <TouchableOpacity style={styles.camIconButton} onPress={handlePickImage}>
            <ImageIcon color="#fff" size={24} />
          </TouchableOpacity>

          <View style={styles.shutterOuter}>
            <TouchableOpacity
              style={[styles.shutterInner, isCapturing && styles.shutterActive]}
              onPress={handleCapture}
              disabled={isCapturing}
            >
              <View style={[styles.shutterCore, styles.shutterCoreBlood]}>
                {isCapturing
                  ? <ActivityIndicator color={THEME.blood} size="large" />
                  : <Microscope color={THEME.blood} size={32} />}
              </View>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.camIconButton}
            onPress={() => router.push('/(tabs)/scanner')}
          >
            <FileText color="#fff" size={24} />
          </TouchableOpacity>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  camera:          { flex: 1 },

  processingOverlay: {
    flex: 1, backgroundColor: '#00000099',
    alignItems: 'center', justifyContent: 'center', gap: 20,
  },
  processingText: {
    color: '#ffffff', fontSize: 16, fontWeight: '600',
  },

  cameraTopBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingHorizontal: 20, paddingTop: 8,
  },

  modePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#00478dcc', paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 99,
  },
  modePillBlood: { backgroundColor: '#c0392bcc' },
  modePillText:  { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 1 },

  camIconButton: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#00000080', alignItems: 'center', justifyContent: 'center',
  },
  camIconButtonActive: { backgroundColor: '#ffffffcc' },

  reticleOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  reticleCircle: {
    width: width * 0.72, height: width * 0.72,
    borderRadius: width * 0.36,
    borderWidth: 2, borderColor: '#ffffff80', overflow: 'hidden',
  },
  reticleActive: { borderColor: '#a9c7ff', borderWidth: 3 },

  reticleHint: {
    marginTop: 18, color: '#ffffffcc', fontSize: 14,
    fontWeight: '600', textAlign: 'center',
  },

  scanLine: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
    backgroundColor: THEME.blood,
    shadowColor: THEME.blood, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9, shadowRadius: 10,
  },

  cameraControls: {
    position: 'absolute', bottom: 48, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-around',
    alignItems: 'center', paddingHorizontal: 32,
  },

  shutterOuter: {
    width: 88, height: 88, borderRadius: 44,
    borderWidth: 2, borderColor: '#ffffff4d',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center',
  },
  shutterActive: { backgroundColor: '#ffffff80' },
  shutterCore: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 2, borderColor: '#0000001a',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterCoreBlood: { borderColor: '#c0392b33' },
});