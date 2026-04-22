import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  TextInput, Switch, Alert, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ChevronLeft, Camera, RotateCcw, Share2 } from 'lucide-react-native';

import { Theme } from '../theme/theme';
import { StepIndicator } from '../components/StepIndicator';
import { RiskBadge } from '../components/RiskBadge';
import { AnimatedProgressBar } from '../components/AnimatedProgressBar';
import { useProfile } from '../components/ProfileContext';
import { CAPTURE_GUIDE_CIRCLE_DIAMETER, CAPTURE_GUIDE_FRAME_HEIGHT } from '../mhrqi/guide';
import { runMhrqiPreprocessPass } from '../mhrqi/pipeline';
import { runFundusModelInference } from '../services/ai/inference';
import { getInferenceBootstrapStatus, prepareInferenceRuntime } from '../services/ai/registry';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppStackParamList } from '../navigation/types';

type EyeSide = 'left' | 'right';
type Step = 'prepare' | 'capture' | 'review' | 'results';

type AnalysisResult = {
  diabeticRetinopathy: number;
  hypertensionRetinopathy: number | null;
  glaucomaSigns: number;
  glaucomaLabel: 'Referable Glaucoma' | 'Non-Referable Glaucoma' | null;
  glaucomaConfidence: number | null;
  estimatedCdr: number | null;
  glaucomaSeverity: 'mild' | 'moderate' | 'severe' | null;
  riskLevel: 'low' | 'medium' | 'high';
  drSeverity: 0 | 1 | 2 | 3 | 4 | null;
  source: 'model' | 'legacy-unverified';
  markerSummary?: string;
};

type ScanRecord = {
  id: string;
  patientCode: string;
  eyeSide: EyeSide;
  hasDiagnosis: boolean;
  conditionName: string;
  capturedAt: string;
  rawUri: string;
  aiProcessedUri: string;
  mhrqiUri?: string | null;
  processedUri: string;
  fileSizeBytes: number;
  analysis: AnalysisResult;
  markerSummary: string;
  trend: string;
};

const STORAGE_KEY = 'glance_scans_v1';
const STEPS: Step[] = ['prepare', 'capture', 'review', 'results'];

function clamp(v: number, min: number, max: number) { return Math.min(Math.max(v, min), max); }

function escapeHtml(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function uriToDataUri(uri: string): Promise<string | null> {
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const ext = uri.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/)?.[1] ?? '';
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${b64}`;
  } catch { return null; }
}

export default function ScanFlowScreen() {
  const navigation = useNavigation<StackNavigationProp<AppStackParamList>>();
  const { profile } = useProfile();

  const [step, setStep] = useState<Step>('prepare');
  const [eyeSide, setEyeSide] = useState<EyeSide>('left');
  const [hasCondition, setHasCondition] = useState(profile?.hasEyeCondition ?? false);
  const [conditionName, setConditionName] = useState(profile?.conditionDescription ?? '');

  const [rawUri, setRawUri] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [savedRecord, setSavedRecord] = useState<ScanRecord | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [captureFrameWidth, setCaptureFrameWidth] = useState(CAPTURE_GUIDE_FRAME_HEIGHT);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [runtimeReason, setRuntimeReason] = useState<string | null>(null);

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const captureLockRef = useRef(false);

  useEffect(() => {
    prepareInferenceRuntime().then(() =>
      getInferenceBootstrapStatus().then(s => {
        setRuntimeReady(s.availability === 'ready');
        setRuntimeReason(s.reason ?? null);
      })
    ).catch(e => {
      setRuntimeReason(e?.message ?? 'Initialization failed');
    });
  }, []);

  const currentStepIndex = STEPS.indexOf(step);
  const patientName = profile?.firstName ?? 'you';

  const cropToGuide = async (uri: string, w: number, h: number): Promise<string> => {
    const frameW = Math.max(1, captureFrameWidth);
    const scale = Math.max(frameW / w, CAPTURE_GUIDE_FRAME_HEIGHT / h);
    const side = Math.max(1, Math.floor(Math.min(CAPTURE_GUIDE_CIRCLE_DIAMETER / scale, w, h)));
    const ox = clamp(Math.round(w / 2 - side / 2), 0, w - side);
    const oy = clamp(Math.round(h / 2 - side / 2), 0, h - side);
    const result = await manipulateAsync(uri, [{ crop: { originX: ox, originY: oy, width: side, height: side } }], { compress: 0.9, format: SaveFormat.JPEG });
    return result.uri;
  };

  const capture = async () => {
    if (captureLockRef.current || !cameraRef.current || !isCameraReady) return;
    captureLockRef.current = true;
    setIsBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, skipProcessing: false });
      if (!photo?.uri) { Alert.alert('Capture failed', 'No image returned.'); return; }
      const cropped = await cropToGuide(photo.uri, photo.width ?? 0, photo.height ?? 0);
      setRawUri(cropped);
      setStep('review');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not capture image.');
    } finally {
      captureLockRef.current = false;
      setIsBusy(false);
    }
  };

  const analyze = async () => {
    if (!rawUri || !runtimeReady) return;
    setIsBusy(true);
    setAnalyzeProgress(0.03);
    try {
      const enhanced = await manipulateAsync(rawUri, [{ resize: { width: 1024, height: 1024 } }], { compress: 0.9, format: SaveFormat.JPEG });
      setAnalyzeProgress(0.2);
      const info = await FileSystem.getInfoAsync(enhanced.uri);
      const size = info.exists && 'size' in info && info.size ? info.size : 0;
      const mhrqi = await runMhrqiPreprocessPass(enhanced.uri, 1024, p => setAnalyzeProgress(0.2 + p * 0.6));
      if (!mhrqi.denoisedUri) throw new Error('Preprocessing failed.');
      const out = await runFundusModelInference(mhrqi.denoisedUri);
      setAnalyzeProgress(0.95);
      const result: AnalysisResult = {
        diabeticRetinopathy: out.diabeticRetinopathy,
        hypertensionRetinopathy: out.hypertensionRetinopathy,
        glaucomaSigns: out.glaucomaSigns,
        glaucomaLabel: out.glaucomaLabel,
        glaucomaConfidence: out.glaucomaConfidence,
        estimatedCdr: out.estimatedCdr,
        glaucomaSeverity: out.glaucomaSeverity,
        riskLevel: out.riskLevel,
        drSeverity: out.drSeverity,
        source: out.source,
      };
      const aiUri = out.glaucomaOverlayUri ?? mhrqi.denoisedUri;
      const record: ScanRecord = {
        id: `${Date.now()}`,
        patientCode: profile?.firstName ?? 'Self',
        eyeSide,
        hasDiagnosis: hasCondition,
        conditionName: hasCondition ? conditionName.trim() : '',
        capturedAt: new Date().toISOString(),
        rawUri,
        aiProcessedUri: aiUri,
        mhrqiUri: mhrqi.mhrqiUri,
        processedUri: aiUri,
        fileSizeBytes: size,
        analysis: result,
        markerSummary: out.markerSummary ?? '',
        trend: 'baseline',
      };
      const raw2 = await AsyncStorage.getItem(STORAGE_KEY);
      const prev: ScanRecord[] = raw2 ? JSON.parse(raw2) : [];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([record, ...prev]));
      setAnalysis(result);
      setSavedRecord(record);
      setAnalyzeProgress(1);
      setStep('results');
    } catch (e: any) {
      Alert.alert('Analysis failed', e?.message ?? 'Please try again.');
      setStep('capture');
    } finally {
      setIsBusy(false);
    }
  };

  const exportPdf = async () => {
    if (!savedRecord) return;
    const [rawData, aiData] = await Promise.all([uriToDataUri(savedRecord.rawUri), uriToDataUri(savedRecord.aiProcessedUri)]);
    const html = `<html><body style="font-family:sans-serif;padding:20px;color:#0f172a">
      <h2>Eye Health Report</h2>
      <p><b>Date:</b> ${new Date(savedRecord.capturedAt).toLocaleString()}</p>
      <p><b>Eye:</b> ${savedRecord.eyeSide === 'left' ? 'Left' : 'Right'}</p>
      <p><b>Result:</b> ${savedRecord.analysis.riskLevel === 'low' ? 'All Clear' : savedRecord.analysis.riskLevel === 'medium' ? 'Keep Watch' : 'See a Doctor'}</p>
      <p>${savedRecord.analysis.riskLevel === 'low' ? 'No signs of concern detected.' : 'Indicators found. Please share with your eye care provider.'}</p>
      ${rawData ? `<img src="${rawData}" style="width:100%;max-height:300px;object-fit:contain;border-radius:8px;margin-top:16px"/>` : ''}
      ${aiData && aiData !== rawData ? `<img src="${aiData}" style="width:100%;max-height:300px;object-fit:contain;border-radius:8px;margin-top:12px"/>` : ''}
      <hr/><p style="font-size:12px;color:#64748b">This report is for informational purposes only and does not constitute a medical diagnosis.</p>
    </body></html>`;
    try {
      const file = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'Share report' });
      } else {
        Alert.alert('Saved', file.uri);
      }
    } catch { Alert.alert('Error', 'Could not generate report.'); }
  };

  const reset = () => {
    setRawUri(null);
    setAnalysis(null);
    setSavedRecord(null);
    setAnalyzeProgress(0);
    setStep('prepare');
  };

  if (!permission) return <SafeAreaView style={styles.root} />;
  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.permissionCard}>
          <Text style={styles.permissionTitle}>Camera access needed</Text>
          <Text style={styles.permissionBody}>Glance needs camera access to capture your eye image.</Text>
          <Pressable style={styles.btn} onPress={requestPermission}>
            <Text style={styles.btnText}>Allow Camera</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable onPress={() => step === 'prepare' ? navigation.goBack() : setStep(STEPS[currentStepIndex - 1] as Step)} style={styles.backBtn}>
          <ChevronLeft size={22} color={Theme.colors.textPrimary} />
        </Pressable>
        <StepIndicator totalSteps={4} currentStep={currentStepIndex} />
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>

        {/* PREPARE */}
        {step === 'prepare' && (
          <View style={styles.card}>
            <Text style={styles.stepTitle}>Which eye?</Text>
            <Text style={styles.stepSub}>Select the eye you want to check today.</Text>
            <View style={styles.eyeToggle}>
              {(['left', 'right'] as EyeSide[]).map(side => (
                <Pressable key={side} style={[styles.eyeBtn, eyeSide === side && styles.eyeBtnActive]} onPress={() => setEyeSide(side)}>
                  <Text style={[styles.eyeBtnText, eyeSide === side && styles.eyeBtnTextActive]}>
                    {side === 'left' ? 'Left' : 'Right'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.divider} />

            <View style={styles.row}>
              <Text style={styles.fieldLabel}>Known eye condition?</Text>
              <Switch value={hasCondition} onValueChange={setHasCondition}
                trackColor={{ false: Theme.colors.borderLight, true: Theme.colors.primaryLight }}
                thumbColor={hasCondition ? Theme.colors.primary : Theme.colors.surface} />
            </View>
            {hasCondition && (
              <TextInput style={styles.input} value={conditionName} onChangeText={setConditionName}
                placeholder="e.g. Diabetic retinopathy" placeholderTextColor={Theme.colors.textTertiary} />
            )}

            <View style={styles.tipBox}>
              <Text style={styles.tipTitle}>Before you start</Text>
              <Text style={styles.tipItem}>• Attach your Glance lens to your camera</Text>
              <Text style={styles.tipItem}>• Find a steady, well-lit spot</Text>
              <Text style={styles.tipItem}>• Remove glasses if wearing any</Text>
            </View>

            {!runtimeReady && (
              <View style={styles.warningBox}>
                <Text style={styles.warningText}>
                  {runtimeReason || 'Setting up AI analysis…'}
                </Text>
              </View>
            )}

            <Pressable style={styles.btn} onPress={() => setStep('capture')}>
              <Text style={styles.btnText}>Start Capture</Text>
            </Pressable>
          </View>
        )}

        {/* CAPTURE */}
        {step === 'capture' && (
          <View style={styles.card}>
            <Text style={styles.stepTitle}>Center your eye</Text>
            <Text style={styles.stepSub}>Hold steady and align your eye within the circle.</Text>
            <View style={[styles.cameraWrap, { height: CAPTURE_GUIDE_FRAME_HEIGHT + 80 }]}
              onLayout={e => { const w = e.nativeEvent.layout.width; if (w > 0) setCaptureFrameWidth(w); }}>
              <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing="back"
                onCameraReady={() => setIsCameraReady(true)} active={step === 'capture'} />
              <View style={styles.circleGuide} />
              <Text style={styles.cameraHint}>Keep your eye steady</Text>
            </View>
            <Pressable style={[styles.btn, (!isCameraReady || isBusy) && styles.btnDisabled]}
              onPress={capture} disabled={!isCameraReady || isBusy}>
              <Camera size={20} color="#fff" />
              <Text style={styles.btnText}>{isBusy ? 'Capturing…' : 'Capture'}</Text>
            </Pressable>
          </View>
        )}

        {/* REVIEW */}
        {step === 'review' && rawUri && (
          <View style={styles.card}>
            <Text style={styles.stepTitle}>Looks good?</Text>
            <Text style={styles.stepSub}>Your eye should be clearly visible and centered.</Text>
            <View style={styles.previewWrap}>
              <Image source={{ uri: rawUri }} style={styles.preview} resizeMode="cover" />
            </View>
            {isBusy && (
              <View style={{ gap: 8 }}>
                <Text style={styles.analyzeLabel}>Analyzing…</Text>
                <AnimatedProgressBar progress={analyzeProgress} color={Theme.colors.primary} height={10} />
              </View>
            )}
            <Pressable style={[styles.btn, (isBusy || !runtimeReady) && styles.btnDisabled]}
              onPress={analyze} disabled={isBusy || !runtimeReady}>
              <Text style={styles.btnText}>{isBusy ? 'Analyzing…' : 'Analyze'}</Text>
            </Pressable>
            <Pressable style={styles.ghostBtn} onPress={() => setStep('capture')}>
              <RotateCcw size={16} color={Theme.colors.textSecondary} />
              <Text style={styles.ghostBtnText}>Retake</Text>
            </Pressable>
          </View>
        )}

        {/* RESULTS */}
        {step === 'results' && analysis && (
          <View style={{ gap: Theme.spacing.lg }}>
            <View style={styles.card}>
              <Text style={styles.stepTitle}>Your results</Text>
              <Text style={styles.stepSub}>{eyeSide === 'left' ? 'Left' : 'Right'} eye · {new Date().toLocaleDateString()}</Text>
              <RiskBadge level={analysis.riskLevel} large />
              {analysis.riskLevel !== 'low' && (
                <View style={styles.tipBox}>
                  <Text style={styles.tipTitle}>Next step</Text>
                  <Text style={styles.tipItem}>
                    {analysis.riskLevel === 'medium'
                      ? 'Monitor closely and scan again in 1–2 weeks.'
                      : 'Share this report with an eye care provider as soon as possible.'}
                  </Text>
                </View>
              )}
            </View>

            <Pressable style={[styles.btn, { marginHorizontal: Theme.spacing.lg }]} onPress={exportPdf}>
              <Share2 size={18} color="#fff" />
              <Text style={styles.btnText}>Share with Doctor</Text>
            </Pressable>
            <Pressable style={[styles.ghostBtn, { marginHorizontal: Theme.spacing.lg }]} onPress={reset}>
              <Text style={styles.ghostBtnText}>Scan Again</Text>
            </Pressable>
            <Pressable style={[styles.ghostBtn, { marginHorizontal: Theme.spacing.lg }]} onPress={() => navigation.navigate('MainTabs')}>
              <Text style={styles.ghostBtnText}>Done</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Theme.colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Theme.spacing.lg, paddingVertical: Theme.spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Theme.colors.surface, justifyContent: 'center', alignItems: 'center', ...Theme.shadows.soft },
  body: { padding: Theme.spacing.lg, gap: Theme.spacing.lg, paddingBottom: 48 },
  card: { backgroundColor: Theme.colors.surface, borderRadius: Theme.borderRadius.xl, padding: Theme.spacing.lg, gap: Theme.spacing.md, ...Theme.shadows.soft },
  stepTitle: { ...Theme.typography.h2, color: Theme.colors.textPrimary },
  stepSub: { ...Theme.typography.body, color: Theme.colors.textSecondary, marginTop: -Theme.spacing.sm },
  eyeToggle: { flexDirection: 'row', gap: Theme.spacing.sm },
  eyeBtn: { flex: 1, borderWidth: 1.5, borderColor: Theme.colors.border, borderRadius: Theme.borderRadius.md, alignItems: 'center', paddingVertical: 14, backgroundColor: Theme.colors.surface },
  eyeBtnActive: { backgroundColor: Theme.colors.primary, borderColor: Theme.colors.primary },
  eyeBtnText: { ...Theme.typography.bodyBold, color: Theme.colors.textSecondary },
  eyeBtnTextActive: { color: '#fff' },
  divider: { height: 1, backgroundColor: Theme.colors.borderLight },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { ...Theme.typography.label, color: Theme.colors.textSecondary },
  input: { ...Theme.typography.body, borderWidth: 1.5, borderColor: Theme.colors.border, borderRadius: Theme.borderRadius.md, paddingHorizontal: Theme.spacing.md, paddingVertical: 12, color: Theme.colors.textPrimary },
  tipBox: { backgroundColor: Theme.colors.backgroundAlt, borderRadius: Theme.borderRadius.md, padding: Theme.spacing.md, gap: 6 },
  tipTitle: { ...Theme.typography.label, color: Theme.colors.primary },
  tipItem: { ...Theme.typography.body, color: Theme.colors.textSecondary, fontSize: 15 },
  warningBox: { backgroundColor: '#fffbeb', borderRadius: Theme.borderRadius.md, padding: Theme.spacing.md, borderWidth: 1, borderColor: '#fcd34d' },
  warningText: { ...Theme.typography.caption, color: '#92400e' },
  btn: { backgroundColor: Theme.colors.primary, borderRadius: Theme.borderRadius.md, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, ...Theme.shadows.medium },
  btnDisabled: { opacity: 0.45 },
  btnText: { ...Theme.typography.bodyBold, color: '#fff', fontSize: 16 },
  ghostBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 6 },
  ghostBtnText: { ...Theme.typography.body, color: Theme.colors.textSecondary },
  cameraWrap: { borderRadius: Theme.borderRadius.xl, overflow: 'hidden', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  circleGuide: { width: CAPTURE_GUIDE_CIRCLE_DIAMETER, height: CAPTURE_GUIDE_CIRCLE_DIAMETER, borderRadius: CAPTURE_GUIDE_CIRCLE_DIAMETER / 2, borderWidth: 2.5, borderColor: '#fff', backgroundColor: 'rgba(255,255,255,0.06)' },
  cameraHint: { position: 'absolute', bottom: 18, alignSelf: 'center', color: '#fff', ...Theme.typography.captionSmall, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  previewWrap: { aspectRatio: 1, borderRadius: Theme.borderRadius.lg, overflow: 'hidden', backgroundColor: '#000' },
  preview: { width: '100%', height: '100%' },
  analyzeLabel: { ...Theme.typography.body, color: Theme.colors.textSecondary, textAlign: 'center' },
  permissionCard: { flex: 1, justifyContent: 'center', padding: Theme.spacing.xl, gap: Theme.spacing.md },
  permissionTitle: { ...Theme.typography.h3, color: Theme.colors.textPrimary },
  permissionBody: { ...Theme.typography.body, color: Theme.colors.textSecondary },
});
