import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
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

  const handleCapture = async () => {
    if (isCapturing || !cameraRef.current) return;
    if (!(await ensureCameraPermission())) return;
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85, base64: false });
      await runInference(photo.uri, 'image/jpeg', 'camera_capture.jpg');
    } catch (e: any) {
      console.error('Capture failed:', e);
      Alert.alert('Capture Failed', e?.message ?? 'Could not process the image. Please try again.');
    } finally {
      setIsCapturing(false);
    }
  };

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
      console.error('File pick failed:', e);
      Alert.alert('File Error', e?.message ?? 'Could not open the file. Please try again.');
    }
  };

  /**
   * Runs inference and forwards ALL result fields to /result as params.
   * Previously this called router.push('/result') with no params — that caused
   * the result screen to always fall back to its 'normal' defaults regardless
   * of what the model actually detected.
   */
  const runInference = async (uri: string, mimeType?: string | null, fileName?: string) => {
    setIsProcessing(true);
    try {
      // ── Step 1: Cell morphology model ─────────────────────────────────────
      setProcessingMsg(`Scanning ${fileName ?? 'file'}…`);
      const mlResult = await mlService.runInference('cell', {
        imageUri: uri,
        mimeType,
        fileName,
      });
      console.log('CELL Result:', mlResult);

      // ── Step 2: Groq LLM disease prediction ──────────────────────────────
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

      // ── Step 3: Navigate with Groq report ────────────────────────────────
      router.push({
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
        },
      });
    } catch (e: any) {
      console.error('Inference failed:', e);
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
          <TouchableOpacity style={styles.camIconButton} onPress={() => router.back()}>
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