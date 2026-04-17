import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import {
  Settings, Camera, Zap, FileUp,
  BarChart3, AlertTriangle, ArrowRight, Cpu, X,
  Microscope, FileText, Image as ImageIcon, FolderOpen,
} from 'lucide-react-native';
import { mlService } from '../../hooks/use-ml-service';
import { useBloodReportAnalysis } from '../../hooks/use-blood-report-analysis';

type ViewState = 'home' | 'camera';

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

export default function ScannerScreen() {
  const { analyzeReport } = useBloodReportAnalysis({
    groqApiKey: process.env.EXPO_PUBLIC_GROQ_API_KEY ?? '',
  });

  const [viewState,    setViewState]    = useState<ViewState>('home');
  const [isCapturing,  setIsCapturing]  = useState(false);
  // ── NEW: separate loading state for file-pick flow ────────────────────────
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMsg,setProcessingMsg]= useState('');
  const [flashOn,      setFlashOn]      = useState(false);
  const [modelStatus,  setModelStatus]  = useState(mlService.getStatus());

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<any>(null);

  useEffect(() => {
    (async () => {
      await mlService.initialize();
      setModelStatus(mlService.getStatus());
    })();
  }, []);

  const ensureCameraPermission = async (): Promise<boolean> => {
    if (permission?.granted) return true;
    const result = await requestPermission();
    if (!result.granted) {
      Alert.alert('Camera Permission Required', 'Please allow camera access in your device settings.', [{ text: 'OK' }]);
      return false;
    }
    return true;
  };

  const openCamera = async () => {
    if (!(await ensureCameraPermission())) return;
    setFlashOn(false);
    setViewState('camera');
  };

  const handleCapture = async () => {
    if (isCapturing || !cameraRef.current) return;
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85, base64: false });

      // Document scanner: pass raw JPEG directly to the OCR model.
      // BMP conversion is only done in scan.tsx for blood-cell analysis.
      await runInference(photo.uri, 'image/jpeg', 'camera_capture.jpg');
    } catch (e: any) {
      Alert.alert('Capture Failed', e?.message ?? 'Could not process the image. Please try again.');
    } finally {
      setIsCapturing(false);
    }
  };

  /**
   * FIX: Pass mimeType + fileName through so BMP/TIFF files on Android are
   * validated by extension fallback when mimeType is null/octet-stream.
   */
  const handlePickImage = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ACCEPTED_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      console.log('Picked file:', asset.name, asset.mimeType, asset.uri);
      await runInference(asset.uri, asset.mimeType, asset.name);
    } catch (e: any) {
      Alert.alert('File Error', e?.message ?? 'Could not open the file. Please try again.');
    }
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ACCEPTED_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      console.log('Picked document:', asset.name, asset.mimeType, asset.uri);
      await runInference(asset.uri, asset.mimeType, asset.name);
    } catch (e: any) {
      Alert.alert('File Error', e?.message ?? 'Could not open the file. Please try again.');
    }
  };

  /**
   * FIX: accepts mimeType + fileName, passes to mlService.
   * Model-not-loaded errors now throw and display an Alert instead of
   * silently succeeding and navigating to /result.
   */
  const runInference = async (uri: string, mimeType?: string | null, fileName?: string) => {
    setIsProcessing(true);
    setViewState('home'); // dismiss camera if open
    try {
      // ── Step 1: OCR / stub inference ─────────────────────────────────────
      setProcessingMsg(`Scanning ${fileName ?? 'document'}…`);
      const mlResult = await mlService.runInference('ocr', {
        imageUri: uri,
        mimeType,
        fileName,
      });
      console.log('OCR Result:', mlResult);

      // ── Step 2: Send OCR text to Groq LLM for disease prediction ─────────
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
Case ID: ${mlResult.caseId}`
      );
      console.log('Groq Report:', groqReport);

      // ── Step 3: Navigate — use replace so back button won't return here ───
      // FIX: router.replace instead of router.push prevents the scanner screen
      // from sitting behind result in the stack. source='scanner' tells the
      // result screen which tab to navigate to if the user presses its back button.
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
          scanMode:           'Lab Report OCR + AI',
          source:             'scanner', // FIX: back destination hint for result.tsx
        },
      });
    } catch (e: any) {
      console.error('Analysis failed:', e);
      Alert.alert(
        'Analysis Failed',
        e?.message ?? 'Could not analyze the document. Please try again.',
      );
    } finally {
      setIsProcessing(false);
      setProcessingMsg('');
    }
  };

  // ── Processing overlay ─────────────────────────────────────────────────────
  if (isProcessing) {
    return (
      <SafeAreaView style={styles.processingContainer}>
        <ActivityIndicator color={THEME.primary} size="large" />
        <Text style={styles.processingText}>{processingMsg}</Text>
        <Text style={styles.processingSubText}>Please wait while HEMO-EDGE analyses your file</Text>
      </SafeAreaView>
    );
  }

  // ── Camera View ────────────────────────────────────────────────────────────
  if (viewState === 'camera') {
    return (
      <View style={styles.cameraContainer}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" enableTorch={flashOn}>
          <SafeAreaView style={styles.cameraTopBar}>
            <TouchableOpacity style={styles.camIconButton} onPress={() => setViewState('home')}>
              <X color="#fff" size={24} />
            </TouchableOpacity>
            <View style={styles.modePill}>
              <FileText color="#fff" size={14} />
              <Text style={styles.modePillText}>DOCUMENT</Text>
            </View>
            <TouchableOpacity
              style={[styles.camIconButton, flashOn && styles.camIconButtonActive]}
              onPress={() => setFlashOn(!flashOn)}
            >
              <Zap color={flashOn ? THEME.primary : '#fff'} size={24} />
            </TouchableOpacity>
          </SafeAreaView>

          <View style={styles.reticleOverlay}>
            <View style={[styles.reticleRect, isCapturing && styles.reticleActive]}>
              <View style={[styles.corner, styles.topLeft]}    />
              <View style={[styles.corner, styles.topRight]}   />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]}/>
              {isCapturing && <View style={styles.scanLine} />}
            </View>
            <Text style={styles.reticleHint}>Align the document within the frame</Text>
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
                <View style={styles.shutterCore}>
                  {isCapturing
                    ? <ActivityIndicator color={THEME.primary} size="large" />
                    : <Camera color={THEME.primary} size={32} />}
                </View>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.camIconButton} onPress={handlePickDocument}>
              <FolderOpen color="#fff" size={24} />
            </TouchableOpacity>
          </View>
        </CameraView>
      </View>
    );
  }

  // ── Home View ──────────────────────────────────────────────────────────────
  const status = modelStatus;
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <FileText color={THEME.primary} size={22} />
          <Text style={styles.brandText}>HEMO-EDGE</Text>
        </View>
        <View style={styles.headerActions}>
          <View style={styles.modelIndicator}>
            <Cpu color={status.ocrLoaded ? THEME.primary : '#d97706'} size={14} />
            <Text style={[styles.modelText, { color: status.ocrLoaded ? THEME.primary : '#d97706' }]}>
              {status.isInitializing ? 'LOADING…' : status.ocrLoaded ? 'OCR READY' : 'MODEL ERROR'}
            </Text>
          </View>
          <TouchableOpacity style={styles.iconButton}>
            <Settings color={THEME.textSecondary} size={22} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.titleSection}>
          <Text style={styles.title}>Lab Report Scanner</Text>
          <Text style={styles.subtitle}>
            Upload or capture lab reports (BMP, TIFF, JPEG, PNG, PDF)
          </Text>
        </View>

        {/* ── Model error warning ─────────────────────────────────────────── */}
        {!status.ocrLoaded && !status.isInitializing && (
          <View style={styles.alertBox}>
            <AlertTriangle color="#d97706" size={20} />
            <View style={styles.alertContent}>
              <Text style={styles.alertTitle}>MODEL NOT LOADED</Text>
              <Text style={styles.alertDesc}>
                Ensure <Text style={{ fontWeight: '700' }}>hemo_edge_quantized.tflite</Text> is in{' '}
                <Text style={{ fontWeight: '700' }}>assets/models/</Text> and rebuild the app.
                File uploads will fail until the model is available.
              </Text>
            </View>
          </View>
        )}

        {/* ── Camera cards ────────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>CAPTURE METHOD</Text>
        <View style={styles.cameraCards}>
          <TouchableOpacity
            style={[styles.cameraCard, styles.cameraCardDocument]}
            onPress={openCamera}
          >
            <View style={[styles.miniCorner, styles.topLeft,    { borderColor: '#3b82f6' }]} />
            <View style={[styles.miniCorner, styles.topRight,   { borderColor: '#3b82f6' }]} />
            <View style={[styles.miniCorner, styles.bottomLeft, { borderColor: '#3b82f6' }]} />
            <View style={[styles.miniCorner, styles.bottomRight,{ borderColor: '#3b82f6' }]} />
            <View style={[styles.cameraCardIcon, { backgroundColor: '#3b82f620' }]}>
              <Camera color="#3b82f6" size={28} />
            </View>
            <Text style={[styles.cameraCardTitle, { color: '#1e3a8a' }]}>Capture Report</Text>
            <Text style={styles.cameraCardSub}>Live document scan using device camera</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.cameraCard, styles.cameraCardBlood]}
            onPress={() => router.push('/(tabs)/scan')}
          >
            <View style={styles.miniCircle} />
            <View style={[styles.cameraCardIcon, { backgroundColor: '#c0392b20' }]}>
              <Microscope color={THEME.blood} size={28} />
            </View>
            <Text style={[styles.cameraCardTitle, { color: THEME.blood }]}>Blood Scan</Text>
            <Text style={styles.cameraCardSub}>Switch to real-time cell morphology mode</Text>
          </TouchableOpacity>
        </View>

        {/* ── File upload methods ──────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>UPLOAD FROM DEVICE</Text>
        <View style={styles.uploadMethods}>
          <TouchableOpacity style={styles.methodCard} onPress={handlePickImage}>
            <View style={styles.methodIconWrapper}>
              <ImageIcon color={THEME.primary} size={22} />
            </View>
            <View style={styles.methodText}>
              <Text style={styles.methodTitle}>Image File</Text>
              <Text style={styles.methodSubtitle}>BMP · TIFF · JPEG · PNG</Text>
            </View>
            <ArrowRight color={THEME.primary} size={18} />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.methodCard, styles.methodCardBlood]} onPress={handlePickDocument}>
            <View style={[styles.methodIconWrapper, { backgroundColor: '#c0392b20' }]}>
              <FileUp color={THEME.blood} size={22} />
            </View>
            <View style={styles.methodText}>
              <Text style={styles.methodTitle}>PDF / Document</Text>
              <Text style={styles.methodSubtitle}>Lab report · Pathology PDF</Text>
            </View>
            <ArrowRight color={THEME.blood} size={18} />
          </TouchableOpacity>
        </View>

        {/* ── Info card ────────────────────────────────────────────────────── */}
        <View style={styles.metricsCard}>
          <View style={styles.metricsHeader}>
            <View style={styles.metricsTitleRow}>
              <BarChart3 color={THEME.primary} size={20} />
              <Text style={styles.metricsTitle}>Supported Formats</Text>
            </View>
            <View style={styles.liveBadge}>
              <Text style={styles.liveText}>v1.4</Text>
            </View>
          </View>
          <View style={styles.metricsList}>
            <MetricItem label="BMP"  value="✓" unit="Bitmap"              confidence="Extension fallback" progress={1}   />
            <MetricItem label="TIFF" value="✓" unit="Tagged Image"        confidence="Extension fallback" progress={1}   />
            <MetricItem label="JPEG" value="✓" unit="Joint Photographic"  confidence="MIME + extension"   progress={1}   />
            <MetricItem label="PNG"  value="✓" unit="Portable Network"    confidence="MIME + extension"   progress={1}   />
            <MetricItem label="PDF"  value="✓" unit="Portable Document"   confidence="MIME type"          progress={0.9} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricItem({ label, value, unit, confidence, progress }: {
  label: string; value: string; unit: string; confidence: string; progress: number;
}) {
  return (
    <View style={styles.metricItem}>
      <View style={styles.metricHeaderRow}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={styles.metricConfidence}>{confidence}</Text>
      </View>
      <View style={styles.metricValueRow}>
        <Text style={styles.metricValue}>{value}</Text>
        <Text style={styles.metricUnit}>{unit}</Text>
      </View>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: THEME.background },
  scrollContent: { padding: 16, paddingBottom: 100 },

  processingContainer: {
    flex: 1, backgroundColor: THEME.background,
    alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  processingText:    { fontSize: 18, fontWeight: '700', color: THEME.text },
  processingSubText: { fontSize: 14, color: THEME.textSecondary, textAlign: 'center', paddingHorizontal: 32 },

  header: {
    height: 64, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 24,
    backgroundColor: '#ffffffcc',
  },
  brand:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandText:   { fontSize: 20, fontWeight: '900', color: THEME.primary, letterSpacing: -1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  modelIndicator: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#00478d10', paddingHorizontal: 8,
    paddingVertical: 4, borderRadius: 8, gap: 6,
  },
  modelText:  { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  iconButton: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  titleSection: { marginBottom: 12, paddingHorizontal: 4 },
  title:        { fontSize: 24, fontWeight: '800', color: THEME.text },
  subtitle:     { fontSize: 14, color: THEME.textSecondary, marginTop: 4 },
  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: THEME.textSecondary,
    letterSpacing: 1.5, marginBottom: 8, paddingHorizontal: 4,
  },

  cameraCards: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  cameraCard: {
    flex: 1, aspectRatio: 0.85, borderRadius: 24, padding: 20,
    justifyContent: 'flex-end', overflow: 'hidden', borderWidth: 1.5,
  },
  cameraCardDocument: { backgroundColor: '#eef2f8', borderColor: '#c0cfe8' },
  cameraCardBlood:    { backgroundColor: '#fdf0ef', borderColor: '#e8b8b4' },
  cameraCardIcon:     { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  cameraCardTitle:    { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  cameraCardSub:      { fontSize: 12, color: THEME.textSecondary, lineHeight: 17 },

  miniCorner:  { position: 'absolute', width: 18, height: 18 },
  topLeft:     { top: 12,    left: 12,    borderTopWidth: 2,    borderLeftWidth: 2,    borderTopLeftRadius: 4     },
  topRight:    { top: 12,    right: 12,   borderTopWidth: 2,    borderRightWidth: 2,   borderTopRightRadius: 4    },
  bottomLeft:  { bottom: 12, left: 12,    borderBottomWidth: 2, borderLeftWidth: 2,    borderBottomLeftRadius: 4  },
  bottomRight: { bottom: 12, right: 12,   borderBottomWidth: 2, borderRightWidth: 2,   borderBottomRightRadius: 4 },
  miniCircle: {
    position: 'absolute', top: 10, right: 10,
    width: 48, height: 48, borderRadius: 24,
    borderWidth: 2, borderColor: '#c0392b40',
  },

  uploadMethods: { gap: 12, marginBottom: 20 },
  methodCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: THEME.cardBg, padding: 14, borderRadius: 20, gap: 12,
  },
  methodCardBlood:    { backgroundColor: '#fdf0ef' },
  methodIconWrapper: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: '#00478d20', alignItems: 'center', justifyContent: 'center',
  },
  methodText:     { flex: 1 },
  methodTitle:    { fontSize: 13, fontWeight: '700', color: THEME.text },
  methodSubtitle: { fontSize: 10, color: THEME.textSecondary, marginTop: 1 },

  cameraContainer: { flex: 1, backgroundColor: '#000' },
  camera:          { flex: 1 },

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
  modePillText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 1 },

  camIconButton: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#00000080', alignItems: 'center', justifyContent: 'center',
  },
  camIconButtonActive: { backgroundColor: '#ffffffcc' },

  reticleOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  reticleRect: {
    width: width * 0.82, aspectRatio: 3 / 4, borderRadius: 12,
    borderWidth: 2, borderColor: '#ffffff80', overflow: 'hidden',
  },
  reticleActive: { borderColor: '#a9c7ff', borderWidth: 3 },

  reticleHint: {
    marginTop: 18, color: '#ffffffcc', fontSize: 14,
    fontWeight: '600', textAlign: 'center',
  },

  scanLine: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
    backgroundColor: THEME.primary,
    shadowColor: THEME.primary, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9, shadowRadius: 10,
  },

  corner: { position: 'absolute', width: 24, height: 24, borderColor: '#a9c7ff' },

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

  metricsCard: {
    backgroundColor: THEME.surface, borderRadius: 24, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.06, shadowRadius: 40, elevation: 4,
    borderWidth: 1, borderColor: '#ffffff', marginTop: 8, marginBottom: 24,
  },
  metricsHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 24,
  },
  metricsTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricsTitle:    { fontSize: 18, fontWeight: '700', color: THEME.text },
  liveBadge:       { backgroundColor: '#00478d15', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  liveText:        { fontSize: 10, fontWeight: '700', color: THEME.primary, letterSpacing: 1 },
  metricsList:     { gap: 16, marginBottom: 24 },
  metricItem: {
    backgroundColor: THEME.cardBg, padding: 12, borderRadius: 12,
    borderLeftWidth: 4, borderLeftColor: THEME.primary, gap: 8,
  },
  metricHeaderRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metricLabel:      { fontSize: 10, fontWeight: '700', color: THEME.textSecondary, letterSpacing: 1 },
  metricConfidence: { fontSize: 10, fontWeight: '500', color: THEME.primary },
  metricValueRow:   { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  metricValue:      { fontSize: 24, fontWeight: '900', color: THEME.text },
  metricUnit:       { fontSize: 14, fontWeight: '500', color: THEME.textSecondary },
  progressBar:      { height: 4, backgroundColor: '#e6e8ea', borderRadius: 2, overflow: 'hidden' },
  progressFill:     { height: '100%', backgroundColor: THEME.primary },

  alertBox: {
    backgroundColor: '#fef9c3', padding: 16, borderRadius: 20,
    flexDirection: 'row', gap: 12, marginBottom: 20,
    borderLeftWidth: 4, borderLeftColor: '#d97706',
  },
  alertContent: { flex: 1 },
  alertTitle:   { fontSize: 10, fontWeight: '800', color: '#92400e', letterSpacing: 0.5 },
  alertDesc:    { fontSize: 13, color: THEME.textSecondary, lineHeight: 18, marginTop: 4 },
});