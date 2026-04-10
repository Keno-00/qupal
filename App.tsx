import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeWithMhrqi } from './src/mhrqi/pipeline';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

type EyeSide = 'left' | 'right';
type Trend = 'baseline' | 'improving' | 'stable' | 'worsening';

type AnalysisResult = {
  diabeticRetinopathy: number;
  hypertensionRetinopathy: number;
  glaucomaSigns: number;
  riskLevel: 'low' | 'medium' | 'high';
};

type ScanRecord = {
  id: string;
  patientCode: string;
  eyeSide: EyeSide;
  hasDiagnosis: boolean;
  conditionName: string;
  capturedAt: string;
  processedUri: string;
  fileSizeBytes: number;
  analysis: AnalysisResult;
  markerSummary: string;
  trend: Trend;
};

type Screen = 'setup' | 'capture' | 'review' | 'report' | 'history';

const STORAGE_KEY = 'glance_scans_v1';

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function deriveRiskLevel(maxProbability: number): 'low' | 'medium' | 'high' {
  if (maxProbability >= 0.67) {
    return 'high';
  }
  if (maxProbability >= 0.4) {
    return 'medium';
  }
  return 'low';
}

function inferMarkerSummary(result: AnalysisResult): string {
  const markers: string[] = [];
  if (result.diabeticRetinopathy >= 0.5) {
    markers.push('microaneurysm-like pattern');
  }
  if (result.hypertensionRetinopathy >= 0.5) {
    markers.push('arteriolar narrowing pattern');
  }
  if (result.glaucomaSigns >= 0.5) {
    markers.push('cup-disc asymmetry pattern');
  }
  if (markers.length === 0) {
    return 'No dominant marker pattern detected in MVP pipeline.';
  }
  return markers.join(', ');
}

function computeTrend(previous: ScanRecord | undefined, currentMax: number): Trend {
  if (!previous) {
    return 'baseline';
  }
  const previousMax = Math.max(
    previous.analysis.diabeticRetinopathy,
    previous.analysis.hypertensionRetinopathy,
    previous.analysis.glaucomaSigns,
  );
  const delta = currentMax - previousMax;
  if (delta > 0.08) {
    return 'worsening';
  }
  if (delta < -0.08) {
    return 'improving';
  }
  return 'stable';
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('setup');
  const [patientCode, setPatientCode] = useState('TEST-001');
  const [hasDiagnosis, setHasDiagnosis] = useState(false);
  const [conditionName, setConditionName] = useState('');
  const [eyeSide, setEyeSide] = useState<EyeSide>('left');

  const [rawUri, setRawUri] = useState<string | null>(null);
  const [processedUri, setProcessedUri] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [markerSummary, setMarkerSummary] = useState('');

  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [isBusy, setIsBusy] = useState(false);

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  useEffect(() => {
    const loadRecords = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as ScanRecord[];
          setRecords(parsed);
        }
      } catch {
        Alert.alert('Storage error', 'Could not load previous scans.');
      }
    };

    loadRecords();
  }, []);

  const previousForCurrentPatient = useMemo(() => {
    const filtered = records
      .filter((r) => r.patientCode === patientCode && r.eyeSide === eyeSide)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    return filtered[0];
  }, [records, patientCode, eyeSide]);

  const saveRecords = async (next: ScanRecord[]) => {
    setRecords(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const capture = async () => {
    if (!cameraRef.current) {
      return;
    }
    try {
      setIsBusy(true);
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        skipProcessing: false,
      });
      if (!photo?.uri) {
        Alert.alert('Capture failed', 'No image URI returned by camera.');
        return;
      }
      setRawUri(photo.uri);
      setProcessedUri(null);
      setAnalysis(null);
      setMarkerSummary('');
      setScreen('review');
    } catch {
      Alert.alert('Capture error', 'Could not capture image.');
    } finally {
      setIsBusy(false);
    }
  };

  const processAndAnalyze = async () => {
    if (!rawUri) {
      return;
    }
    try {
      setIsBusy(true);
      const enhanced = await manipulateAsync(rawUri, [{ resize: { width: 1024, height: 1024 } }], {
        compress: 0.9,
        format: SaveFormat.JPEG,
      });

      const info = await FileSystem.getInfoAsync(enhanced.uri);
      const size = info.exists && 'size' in info && info.size ? info.size : 0;

      const mhrqiScores = await analyzeWithMhrqi(enhanced.uri, 1024);

      const diabetic = mhrqiScores.diabeticRetinopathy;
      const hyper = mhrqiScores.hypertensionRetinopathy;
      const glaucoma = mhrqiScores.glaucomaSigns;
      const maxProbability = Math.max(diabetic, hyper, glaucoma);

      const result: AnalysisResult = {
        diabeticRetinopathy: diabetic,
        hypertensionRetinopathy: hyper,
        glaucomaSigns: glaucoma,
        riskLevel: deriveRiskLevel(maxProbability),
      };

      const summary = mhrqiScores.markerSummary || inferMarkerSummary(result);

      const trend = hasDiagnosis
        ? computeTrend(previousForCurrentPatient, maxProbability)
        : 'baseline';

      const record: ScanRecord = {
        id: `${Date.now()}`,
        patientCode,
        eyeSide,
        hasDiagnosis,
        conditionName: hasDiagnosis ? conditionName.trim() : '',
        capturedAt: new Date().toISOString(),
        processedUri: enhanced.uri,
        fileSizeBytes: size,
        analysis: result,
        markerSummary: summary,
        trend,
      };

      const nextRecords = [record, ...records];
      await saveRecords(nextRecords);

      setProcessedUri(enhanced.uri);
      setAnalysis(result);
      setMarkerSummary(summary);
      setScreen('report');
    } catch {
      Alert.alert('Processing error', 'Could not process and analyze image.');
    } finally {
      setIsBusy(false);
    }
  };

  const exportPdf = async () => {
    if (!analysis) {
      return;
    }

    const latest = records[0];
    if (!latest) {
      return;
    }

    const html = `
      <html>
        <body style="font-family: sans-serif; padding: 16px;">
          <h2>Preliminary Ocular Risk Assessment</h2>
          <p><b>Patient code:</b> ${latest.patientCode}</p>
          <p><b>Capture time:</b> ${new Date(latest.capturedAt).toLocaleString()}</p>
          <p><b>Eye side:</b> ${latest.eyeSide}</p>
          <p><b>Risk level:</b> ${latest.analysis.riskLevel}</p>
          <p><b>Marker summary:</b> ${latest.markerSummary}</p>
          <p><b>Detailed probabilities</b></p>
          <ul>
            <li>Diabetic retinopathy pattern: ${formatPct(latest.analysis.diabeticRetinopathy)}</li>
            <li>Hypertension retinopathy pattern: ${formatPct(latest.analysis.hypertensionRetinopathy)}</li>
            <li>Glaucoma-related pattern: ${formatPct(latest.analysis.glaucomaSigns)}</li>
          </ul>
          <p><b>Trend:</b> ${latest.trend}</p>
          <hr/>
          <p style="font-size: 12px;">Disclaimer: This is a functionality-stage preliminary pre-diagnosis support output for clinician review and not a definitive diagnosis.</p>
        </body>
      </html>
    `;

    try {
      const file = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Share risk report',
          UTI: '.pdf',
        });
      } else {
        Alert.alert('PDF ready', `Saved at: ${file.uri}`);
      }
    } catch {
      Alert.alert('Export failed', 'Could not generate PDF report.');
    }
  };

  const resetFlow = () => {
    setRawUri(null);
    setProcessedUri(null);
    setAnalysis(null);
    setMarkerSummary('');
    setScreen('setup');
  };

  const clearAllLocalData = async () => {
    Alert.alert('Clear all scans', 'Delete all locally stored scan history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem(STORAGE_KEY);
          setRecords([]);
        },
      },
    ]);
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.root}>
        <Text>Loading camera permission state...</Text>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.card}>
          <Text style={styles.title}>Camera access required</Text>
          <Text style={styles.body}>This MVP requires camera permission to capture fundus images.</Text>
          <Pressable style={styles.primaryButton} onPress={requestPermission}>
            <Text style={styles.buttonText}>Grant camera permission</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {screen === 'setup' && (
          <View style={styles.card}>
            <Text style={styles.title}>Functional MVP Setup</Text>
            <Text style={styles.label}>Patient code (non-PII)</Text>
            <TextInput
              style={styles.input}
              value={patientCode}
              onChangeText={setPatientCode}
              autoCapitalize="characters"
            />

            <Text style={styles.label}>Eye side</Text>
            <View style={styles.row}>
              <Pressable
                style={[styles.toggleButton, eyeSide === 'left' && styles.toggleButtonActive]}
                onPress={() => setEyeSide('left')}
              >
                <Text>Left</Text>
              </Pressable>
              <Pressable
                style={[styles.toggleButton, eyeSide === 'right' && styles.toggleButtonActive]}
                onPress={() => setEyeSide('right')}
              >
                <Text>Right</Text>
              </Pressable>
            </View>

            <View style={styles.rowBetween}>
              <Text style={styles.label}>Existing diagnosis?</Text>
              <Switch value={hasDiagnosis} onValueChange={setHasDiagnosis} />
            </View>

            {hasDiagnosis && (
              <>
                <Text style={styles.label}>Condition name</Text>
                <TextInput
                  style={styles.input}
                  value={conditionName}
                  onChangeText={setConditionName}
                  placeholder="e.g., diabetic retinopathy"
                />
              </>
            )}

            <View style={styles.guideBox}>
              <Text style={styles.guideTitle}>Attachment guidance</Text>
              <Text style={styles.body}>1) Clip fundus attachment onto camera.</Text>
              <Text style={styles.body}>2) Align pupil within central circle.</Text>
              <Text style={styles.body}>3) Adjust distance until retina looks sharp.</Text>
            </View>

            <Pressable style={styles.primaryButton} onPress={() => setScreen('capture')}>
              <Text style={styles.buttonText}>Start capture</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setScreen('history')}>
              <Text>Open progression history</Text>
            </Pressable>
          </View>
        )}

        {screen === 'capture' && (
          <View style={styles.card}>
            <Text style={styles.title}>Image Capture</Text>
            <View style={styles.cameraWrap}>
              <CameraView ref={cameraRef} style={styles.camera} facing="back" />
              <View style={styles.overlayCenterCircle} />
              <Text style={styles.overlayText}>Center retina in circle</Text>
            </View>
            <Pressable style={styles.primaryButton} onPress={capture} disabled={isBusy}>
              <Text style={styles.buttonText}>{isBusy ? 'Capturing...' : 'Capture image'}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setScreen('setup')}>
              <Text>Back</Text>
            </Pressable>
          </View>
        )}

        {screen === 'review' && (
          <View style={styles.card}>
            <Text style={styles.title}>Review and Process</Text>
            <Text style={styles.body}>Image captured. Continue to processing and analysis.</Text>
            <Pressable style={styles.primaryButton} onPress={processAndAnalyze} disabled={isBusy}>
              <Text style={styles.buttonText}>{isBusy ? 'Processing...' : 'Process and analyze'}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setScreen('capture')}>
              <Text>Retake</Text>
            </Pressable>
          </View>
        )}

        {screen === 'report' && analysis && (
          <View style={styles.card}>
            <Text style={styles.title}>Pre-diagnosis Report</Text>
            <Text style={styles.body}>Patient: {patientCode}</Text>
            <Text style={styles.body}>Eye: {eyeSide}</Text>
            <Text style={styles.body}>Risk level: {analysis.riskLevel}</Text>
            <Text style={styles.body}>DR probability: {formatPct(analysis.diabeticRetinopathy)}</Text>
            <Text style={styles.body}>HTN probability: {formatPct(analysis.hypertensionRetinopathy)}</Text>
            <Text style={styles.body}>Glaucoma probability: {formatPct(analysis.glaucomaSigns)}</Text>
            <Text style={styles.body}>Marker summary: {markerSummary}</Text>
            <Text style={styles.body}>Processed image: {processedUri ? 'ready' : 'missing'}</Text>
            <Text style={styles.body}>Flow selected: {hasDiagnosis ? 'Progression tracking' : 'Risk assessment'}</Text>

            <Pressable style={styles.primaryButton} onPress={exportPdf}>
              <Text style={styles.buttonText}>Export PDF report</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setScreen('history')}>
              <Text>View progression history</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={resetFlow}>
              <Text>New scan</Text>
            </Pressable>
          </View>
        )}

        {screen === 'history' && (
          <View style={styles.card}>
            <Text style={styles.title}>Progression Tracking</Text>
            {records.length === 0 && <Text style={styles.body}>No local scans yet.</Text>}

            {records.map((r) => (
              <View key={r.id} style={styles.historyItem}>
                <Text style={styles.historyText}>Patient: {r.patientCode}</Text>
                <Text style={styles.historyText}>Date: {new Date(r.capturedAt).toLocaleString()}</Text>
                <Text style={styles.historyText}>Eye: {r.eyeSide}</Text>
                <Text style={styles.historyText}>Risk: {r.analysis.riskLevel}</Text>
                <Text style={styles.historyText}>Trend: {r.trend}</Text>
              </View>
            ))}

            <Pressable style={styles.primaryButton} onPress={() => setScreen('setup')}>
              <Text style={styles.buttonText}>Back to setup</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={clearAllLocalData}>
              <Text>Clear all local data</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {isBusy && (
        <View style={styles.busyOverlay}>
          <ActivityIndicator size="large" />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 14,
    gap: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  body: {
    fontSize: 14,
    color: '#111827',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 8,
  },
  toggleButtonActive: {
    backgroundColor: '#e5e7eb',
  },
  guideBox: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#f9fafb',
  },
  guideTitle: {
    fontWeight: '700',
    marginBottom: 4,
  },
  cameraWrap: {
    height: 320,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#111827',
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  overlayCenterCircle: {
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 2,
    borderColor: '#ffffff',
    backgroundColor: 'transparent',
  },
  overlayText: {
    position: 'absolute',
    bottom: 12,
    color: '#ffffff',
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: '#111827',
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 12,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 12,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  historyItem: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 10,
    gap: 2,
    backgroundColor: '#fafafa',
  },
  historyText: {
    fontSize: 13,
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
