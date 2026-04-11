import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CAPTURE_GUIDE_CIRCLE_DIAMETER, CAPTURE_GUIDE_FRAME_HEIGHT } from './src/mhrqi/guide';
import { runMhrqiPreprocessPass } from './src/mhrqi/pipeline';
import { runFundusModelInference } from './src/services/ai/inference';
import { getInferenceBootstrapStatus, prepareInferenceRuntime } from './src/services/ai/registry';
import {
  Alert,
  Image,
  LayoutChangeEvent,
  Pressable,
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
  hypertensionRetinopathy: number | null;
  glaucomaSigns: number;
  riskLevel: 'low' | 'medium' | 'high';
  drSeverity: 0 | 1 | 2 | 3 | 4 | null;
  source: 'model' | 'legacy-unverified';
};

type QueueStatus = 'queued' | 'processing' | 'completed' | 'failed';

type ProcessingJob = {
  id: string;
  patientCode: string;
  eyeSide: EyeSide;
  hasDiagnosis: boolean;
  conditionName: string;
  rawUri: string;
  createdAt: string;
  status: QueueStatus;
  progress: number;
  recordId?: string;
  mhrqiUri?: string | null;
  processedUri?: string;
  analysis?: AnalysisResult;
  markerSummary?: string;
  trend?: Trend;
  error?: string;
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
  trend: Trend;
};

type Screen = 'setup' | 'capture' | 'review' | 'report' | 'history' | 'record';

const STORAGE_KEY = 'glance_scans_v1';

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatNullablePct(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }
  return formatPct(value);
}

function parseMarkers(summary: string): string[] {
  return summary
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function queueStatusLabel(status: QueueStatus): string {
  if (status === 'queued') {
    return 'Queued';
  }
  if (status === 'processing') {
    return 'Processing';
  }
  if (status === 'completed') {
    return 'Completed';
  }
  return 'Failed';
}

function computeTrend(previous: ScanRecord | undefined, currentMax: number): Trend {
  if (!previous) {
    return 'baseline';
  }
  const previousMax = Math.max(
    previous.analysis.diabeticRetinopathy,
    previous.analysis.hypertensionRetinopathy ?? 0,
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
  const [queue, setQueue] = useState<ProcessingJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [inferenceBootstrap, setInferenceBootstrap] = useState<{
    availability: 'ready' | 'unavailable';
    reason?: string;
  }>({ availability: 'unavailable', reason: 'Checking AI runtime...' });
  const [isRetryingAiSetup, setIsRetryingAiSetup] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraErrorMessage, setCameraErrorMessage] = useState<string | null>(null);
  const [captureFrameWidth, setCaptureFrameWidth] = useState<number>(CAPTURE_GUIDE_FRAME_HEIGHT);

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const recordsRef = useRef<ScanRecord[]>([]);
  const processingLockRef = useRef(false);
  const captureLockRef = useRef(false);

  const refreshInferenceBootstrap = async () => {
    setIsRetryingAiSetup(true);
    try {
      await prepareInferenceRuntime();
      const status = await getInferenceBootstrapStatus();
      setInferenceBootstrap(status);
    } finally {
      setIsRetryingAiSetup(false);
    }
  };

  useEffect(() => {
    const check = async () => {
      await refreshInferenceBootstrap();
    };
    void check();
  }, []);

  useEffect(() => {
    const loadRecords = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as ScanRecord[];
          const hydrated = parsed.map((record) => {
            return {
              ...record,
              rawUri: typeof (record as Partial<ScanRecord>).rawUri === 'string'
                ? (record as Partial<ScanRecord>).rawUri as string
                : record.processedUri,
              aiProcessedUri: typeof (record as Partial<ScanRecord>).aiProcessedUri === 'string'
                ? (record as Partial<ScanRecord>).aiProcessedUri as string
                : record.processedUri,
              mhrqiUri: typeof (record as Partial<ScanRecord>).mhrqiUri === 'string'
                ? (record as Partial<ScanRecord>).mhrqiUri as string
                : null,
              analysis: {
                ...record.analysis,
                drSeverity:
                  typeof record.analysis?.drSeverity === 'number'
                    ? record.analysis.drSeverity
                    : null,
                source: record.analysis?.source ?? 'legacy-unverified',
                hypertensionRetinopathy:
                  typeof record.analysis?.hypertensionRetinopathy === 'number'
                    ? record.analysis.hypertensionRetinopathy
                    : null,
              },
            };
          });
          setRecords(hydrated);
        }
      } catch {
        Alert.alert('Storage error', 'Could not load previous scans.');
      }
    };

    loadRecords();
  }, []);

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  useEffect(() => {
    if (screen === 'capture') {
      setIsCameraReady(false);
      setCameraErrorMessage(null);
    }
  }, [screen]);

  const safeTakePicture = async () => {
    if (!cameraRef.current) {
      throw new Error('Camera reference is unavailable.');
    }

    try {
      return await cameraRef.current.takePictureAsync({
        quality: 0.8,
        skipProcessing: false,
      });
    } catch (firstError) {
      const firstMessage =
        firstError instanceof Error && firstError.message
          ? firstError.message
          : 'Unknown camera capture error.';

      const retryable =
        firstMessage.includes('has been rejected') ||
        firstMessage.includes('Camera is not running') ||
        firstMessage.includes('E_CAMERA_UNAVAILABLE');

      if (!retryable) {
        throw firstError;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));

      if (!cameraRef.current) {
        throw new Error('Camera became unavailable before retry.');
      }

      return await cameraRef.current.takePictureAsync({
        quality: 0.8,
        skipProcessing: false,
      });
    }
  };

  const onCameraMountError = (event: { message: string }) => {
    const message = event.message || 'Camera failed to initialize.';
    setCameraErrorMessage(message);
    setIsCameraReady(false);
  };

  const onCaptureFrameLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    if (nextWidth > 0) {
      setCaptureFrameWidth(nextWidth);
    }
  };

  const cropToGuideSquare = async (
    uri: string,
    imageWidth: number,
    imageHeight: number,
  ): Promise<string> => {
    if (imageWidth < 1 || imageHeight < 1) {
      throw new Error('Captured image dimensions are invalid.');
    }

    const frameWidth = Math.max(1, captureFrameWidth);
    const frameHeight = CAPTURE_GUIDE_FRAME_HEIGHT;
    const coverScale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight);

    const guideSideInImage = CAPTURE_GUIDE_CIRCLE_DIAMETER / coverScale;
    const cropSide = Math.max(1, Math.floor(Math.min(guideSideInImage, imageWidth, imageHeight)));

    const centerX = imageWidth / 2;
    const centerY = imageHeight / 2;

    const originX = clamp(Math.round(centerX - cropSide / 2), 0, imageWidth - cropSide);
    const originY = clamp(Math.round(centerY - cropSide / 2), 0, imageHeight - cropSide);

    const cropped = await manipulateAsync(
      uri,
      [
        {
          crop: {
            originX,
            originY,
            width: cropSide,
            height: cropSide,
          },
        },
      ],
      {
        compress: 0.9,
        format: SaveFormat.JPEG,
      },
    );

    return cropped.uri;
  };

  const previousForCurrentPatient = useMemo(() => {
    const filtered = records
      .filter((r) => r.patientCode === patientCode && r.eyeSide === eyeSide)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    return filtered[0];
  }, [records, patientCode, eyeSide]);

  const selectedRecord = useMemo(() => {
    if (!selectedRecordId) {
      return null;
    }
    return records.find((record) => record.id === selectedRecordId) ?? null;
  }, [records, selectedRecordId]);

  const saveRecords = async (next: ScanRecord[]) => {
    setRecords(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const updateQueueJob = (id: string, patch: Partial<ProcessingJob>) => {
    setQueue((prev) => prev.map((job) => (job.id === id ? { ...job, ...patch } : job)));
  };

  const appendRecord = async (record: ScanRecord) => {
    const nextRecords = [record, ...recordsRef.current];
    recordsRef.current = nextRecords;
    await saveRecords(nextRecords);
  };

  const startQueueJob = async (job: ProcessingJob) => {
    if (processingLockRef.current) {
      return;
    }
    processingLockRef.current = true;

    try {
      setActiveJobId(job.id);
      updateQueueJob(job.id, { status: 'processing', progress: 0.03, error: undefined });

      const enhanced = await manipulateAsync(job.rawUri, [{ resize: { width: 1024, height: 1024 } }], {
        compress: 0.9,
        format: SaveFormat.JPEG,
      });
      updateQueueJob(job.id, { progress: 0.18 });

      const info = await FileSystem.getInfoAsync(enhanced.uri);
      const size = info.exists && 'size' in info && info.size ? info.size : 0;

      const mhrqiPass = await runMhrqiPreprocessPass(enhanced.uri, 1024, (stageProgress) => {
        const mapped = 0.2 + stageProgress * 0.75;
        updateQueueJob(job.id, { progress: mapped });
      });

      if (!mhrqiPass.outputUri) {
        throw new Error('MHRQI preprocessing did not produce an output image for AI inference.');
      }

      const modelOutput = await runFundusModelInference(mhrqiPass.outputUri);

      const diabetic = modelOutput.diabeticRetinopathy;
      const hyper = modelOutput.hypertensionRetinopathy;
      const glaucoma = modelOutput.glaucomaSigns;
      const maxProbability = Math.max(diabetic, hyper ?? 0, glaucoma);

      const result: AnalysisResult = {
        diabeticRetinopathy: diabetic,
        hypertensionRetinopathy: hyper,
        glaucomaSigns: glaucoma,
        riskLevel: modelOutput.riskLevel,
        drSeverity: modelOutput.drSeverity,
        source: modelOutput.source,
      };

      const summary = modelOutput.markerSummary || 'Model did not provide marker summary.';
      const previous = recordsRef.current
        .filter((r) => r.patientCode === job.patientCode && r.eyeSide === job.eyeSide)
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];

      const trend = job.hasDiagnosis ? computeTrend(previous, maxProbability) : 'baseline';

      const record: ScanRecord = {
        id: `${Date.now()}`,
        patientCode: job.patientCode,
        eyeSide: job.eyeSide,
        hasDiagnosis: job.hasDiagnosis,
        conditionName: job.hasDiagnosis ? job.conditionName.trim() : '',
        capturedAt: new Date().toISOString(),
        rawUri: job.rawUri,
        aiProcessedUri: mhrqiPass.outputUri,
        mhrqiUri: mhrqiPass.outputUri,
        processedUri: mhrqiPass.outputUri,
        fileSizeBytes: size,
        analysis: result,
        markerSummary: summary,
        trend,
      };

      await appendRecord(record);
      updateQueueJob(job.id, {
        status: 'completed',
        progress: 1,
        recordId: record.id,
        mhrqiUri: mhrqiPass.outputUri,
        processedUri: mhrqiPass.outputUri,
        analysis: result,
        markerSummary: summary,
        trend,
      });

      setProcessedUri(mhrqiPass.outputUri);
      setAnalysis(result);
      setMarkerSummary(summary);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Could not process and analyze image.';
      updateQueueJob(job.id, {
        status: 'failed',
        error: message,
      });
    } finally {
      processingLockRef.current = false;
      setActiveJobId(null);
    }
  };

  useEffect(() => {
    if (activeJobId) {
      return;
    }
    const nextJob = queue.find((job) => job.status === 'queued');
    if (!nextJob) {
      return;
    }
    void startQueueJob(nextJob);
  }, [queue, activeJobId]);

  const capture = async () => {
    if (captureLockRef.current) {
      return;
    }
    if (!cameraRef.current) {
      Alert.alert('Capture error', 'Camera is not initialized yet. Please wait a moment and try again.');
      return;
    }
    if (!isCameraReady) {
      Alert.alert('Capture error', 'Camera is still warming up. Please try again in a moment.');
      return;
    }
    try {
      captureLockRef.current = true;
      setIsBusy(true);
      const photo = await safeTakePicture();
      if (!photo?.uri) {
        Alert.alert('Capture failed', 'No image URI returned by camera.');
        return;
      }

      const imageWidth = typeof photo.width === 'number' ? photo.width : 0;
      const imageHeight = typeof photo.height === 'number' ? photo.height : 0;
      const centeredSquareUri = await cropToGuideSquare(photo.uri, imageWidth, imageHeight);

      setRawUri(centeredSquareUri);
      setProcessedUri(null);
      setAnalysis(null);
      setMarkerSummary('');
      setScreen('review');
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Could not capture image.';
      Alert.alert('Capture error', message);
    } finally {
      captureLockRef.current = false;
      setIsBusy(false);
    }
  };

  const enqueueForProcessing = () => {
    if (inferenceBootstrap.availability !== 'ready') {
      Alert.alert(
        'AI runtime unavailable',
        inferenceBootstrap.reason ?? 'On-device AI runtime is unavailable.',
      );
      return;
    }

    if (!rawUri) {
      return;
    }
    const nextJob: ProcessingJob = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      patientCode,
      eyeSide,
      hasDiagnosis,
      conditionName,
      rawUri,
      createdAt: new Date().toISOString(),
      status: 'queued',
      progress: 0,
    };

    setQueue((prev) => [nextJob, ...prev]);
    setRawUri(null);
    setScreen('history');
    Alert.alert('Added to queue', 'Image was queued for background processing.');
  };

  const exportPdf = async (record: ScanRecord | null) => {
    if (!record) {
      return;
    }

    const html = `
      <html>
        <body style="font-family: sans-serif; padding: 16px;">
          <h2>Preliminary Ocular Risk Assessment</h2>
          <p><b>Patient code:</b> ${record.patientCode}</p>
          <p><b>Capture time:</b> ${new Date(record.capturedAt).toLocaleString()}</p>
          <p><b>Eye side:</b> ${record.eyeSide}</p>
          <p><b>Risk level:</b> ${record.analysis.riskLevel}</p>
          <p><b>Marker summary:</b> ${record.markerSummary}</p>
          <p><b>Detailed probabilities</b></p>
          <ul>
            <li>Diabetic retinopathy pattern: ${formatPct(record.analysis.diabeticRetinopathy)}</li>
            <li>Hypertension retinopathy pattern: ${formatNullablePct(record.analysis.hypertensionRetinopathy)}</li>
            <li>Glaucoma-related pattern: ${formatPct(record.analysis.glaucomaSigns)}</li>
          </ul>
          <p><b>Trend:</b> ${record.trend}</p>
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
    setSelectedRecordId(null);
    setScreen('setup');
  };

  const openRecordDetails = (recordId: string) => {
    setSelectedRecordId(recordId);
    setScreen('record');
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

            {inferenceBootstrap.availability !== 'ready' && (
              <View style={styles.warningBox}>
                <Text style={styles.warningTitle}>AI runtime not ready</Text>
                <Text style={styles.warningText}>
                  {inferenceBootstrap.reason ?? 'On-device model runtime is not available.'}
                </Text>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => {
                    void refreshInferenceBootstrap();
                  }}
                  disabled={isRetryingAiSetup}
                >
                  <Text>{isRetryingAiSetup ? 'Retrying AI setup...' : 'Retry AI setup'}</Text>
                </Pressable>
              </View>
            )}

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
            <View style={styles.cameraWrap} onLayout={onCaptureFrameLayout}>
              <CameraView
                ref={cameraRef}
                style={styles.camera}
                facing="back"
                onCameraReady={() => setIsCameraReady(true)}
                onMountError={onCameraMountError}
                active={screen === 'capture'}
              />
              <View style={styles.overlayCenterCircle} />
              <Text style={styles.overlayText}>Center retina in circle</Text>
            </View>
            {!isCameraReady && <Text style={styles.warningText}>Camera is initializing...</Text>}
            {cameraErrorMessage && <Text style={styles.warningText}>Camera error: {cameraErrorMessage}</Text>}
            <Pressable style={styles.primaryButton} onPress={capture} disabled={isBusy || !isCameraReady}>
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
            <Text style={styles.body}>Image captured. Add it to queue so processing runs in the background.</Text>
            <Pressable
              style={[
                styles.primaryButton,
                inferenceBootstrap.availability !== 'ready' && styles.primaryButtonDisabled,
              ]}
              onPress={enqueueForProcessing}
              disabled={inferenceBootstrap.availability !== 'ready'}
            >
              <Text style={styles.buttonText}>Add to processing queue</Text>
            </Pressable>
            {inferenceBootstrap.availability !== 'ready' && (
              <Text style={styles.warningText}>
                Queue is disabled until on-device model runtime is configured.
              </Text>
            )}
            {inferenceBootstrap.availability !== 'ready' && (
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  void refreshInferenceBootstrap();
                }}
                disabled={isRetryingAiSetup}
              >
                <Text>{isRetryingAiSetup ? 'Retrying AI setup...' : 'Retry AI setup'}</Text>
              </Pressable>
            )}
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
            <Text style={styles.body}>DR severity class: {analysis.drSeverity ?? 'n/a'}</Text>
            <Text style={styles.body}>DR probability: {formatPct(analysis.diabeticRetinopathy)}</Text>
            <Text style={styles.body}>HTN probability: {formatNullablePct(analysis.hypertensionRetinopathy)}</Text>
            <Text style={styles.body}>Glaucoma probability: {formatPct(analysis.glaucomaSigns)}</Text>
            <Text style={styles.body}>Marker summary: {markerSummary}</Text>
            <Text style={styles.body}>Inference source: {analysis.source}</Text>
            <Text style={styles.body}>Processed image: {processedUri ? 'ready' : 'missing'}</Text>
            <Text style={styles.body}>Flow selected: {hasDiagnosis ? 'Progression tracking' : 'Risk assessment'}</Text>

            <Pressable style={styles.primaryButton} onPress={() => exportPdf(records[0] ?? null)}>
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

            <Text style={styles.label}>Processing Queue</Text>
            {queue.length === 0 && <Text style={styles.body}>No queued jobs.</Text>}
            {queue.map((job) => (
              <Pressable
                key={job.id}
                style={styles.historyItem}
                onPress={() => {
                  const completed = job.recordId
                    ? records.find((record) => record.id === job.recordId)
                    : undefined;
                  if (completed) {
                    openRecordDetails(completed.id);
                  }
                }}
              >
                <Text style={styles.historyText}>Patient: {job.patientCode}</Text>
                <Text style={styles.historyText}>Eye: {job.eyeSide}</Text>
                <Text style={styles.historyText}>Status: {queueStatusLabel(job.status)}</Text>
                <Text style={styles.historyText}>Progress: {Math.round(job.progress * 100)}%</Text>

                <View style={styles.previewWrap}>
                  <Image
                    source={{ uri: job.processedUri || job.rawUri }}
                    style={styles.previewImage}
                    resizeMode="cover"
                  />
                </View>
                {job.analysis && (
                  <>
                    <Text style={styles.historyText}>Risk: {job.analysis.riskLevel}</Text>
                    <Text style={styles.historyText}>DR class: {job.analysis.drSeverity ?? 'n/a'}</Text>
                    <Text style={styles.historyText}>Source: {job.analysis.source}</Text>
                    <Text style={styles.historyText}>
                      DR {formatPct(job.analysis.diabeticRetinopathy)} | HTN{' '}
                      {formatNullablePct(job.analysis.hypertensionRetinopathy)} | GL {formatPct(job.analysis.glaucomaSigns)}
                    </Text>
                  </>
                )}
                {job.error && <Text style={styles.historyText}>Error: {job.error}</Text>}
              </Pressable>
            ))}

            <Text style={styles.label}>Saved Scans</Text>
            {records.length === 0 && <Text style={styles.body}>No local scans yet.</Text>}

            {records.map((r) => (
              <Pressable key={r.id} style={styles.historyItem} onPress={() => openRecordDetails(r.id)}>
                <Text style={styles.historyText}>Patient: {r.patientCode}</Text>
                <Text style={styles.historyText}>Date: {new Date(r.capturedAt).toLocaleString()}</Text>
                <Text style={styles.historyText}>Eye: {r.eyeSide}</Text>
                <Text style={styles.historyText}>Risk: {r.analysis.riskLevel}</Text>
                <Text style={styles.historyText}>Trend: {r.trend}</Text>
                <Text style={styles.historyText}>Tap to open full record and export PDF</Text>
              </Pressable>
            ))}

            <Pressable style={styles.primaryButton} onPress={() => setScreen('setup')}>
              <Text style={styles.buttonText}>Back to setup</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={clearAllLocalData}>
              <Text>Clear all local data</Text>
            </Pressable>
          </View>
        )}

        {screen === 'record' && selectedRecord && (
          <View style={styles.card}>
            <Text style={styles.title}>Record Details</Text>
            <Text style={styles.body}>Patient: {selectedRecord.patientCode}</Text>
            <Text style={styles.body}>Date: {new Date(selectedRecord.capturedAt).toLocaleString()}</Text>
            <Text style={styles.body}>Eye: {selectedRecord.eyeSide}</Text>
            <Text style={styles.body}>Trend: {selectedRecord.trend}</Text>
            <Text style={styles.body}>Risk level: {selectedRecord.analysis.riskLevel}</Text>
            <Text style={styles.body}>DR severity class: {selectedRecord.analysis.drSeverity ?? 'n/a'}</Text>
            <Text style={styles.body}>DR probability: {formatPct(selectedRecord.analysis.diabeticRetinopathy)}</Text>
            <Text style={styles.body}>
              HTN probability: {formatNullablePct(selectedRecord.analysis.hypertensionRetinopathy)}
            </Text>
            <Text style={styles.body}>Glaucoma probability: {formatPct(selectedRecord.analysis.glaucomaSigns)}</Text>
            <Text style={styles.body}>Marker summary: {selectedRecord.markerSummary}</Text>

            <Text style={styles.label}>Clinical annotation tags</Text>
            <View style={styles.annotationRow}>
              {parseMarkers(selectedRecord.markerSummary).map((marker) => (
                <View key={`${selectedRecord.id}-${marker}`} style={styles.annotationTag}>
                  <Text style={styles.annotationTagText}>{marker}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.label}>Original fundus capture</Text>
            <View style={styles.previewWrap}>
              <Image source={{ uri: selectedRecord.rawUri }} style={styles.previewImage} resizeMode="cover" />
            </View>

            <Text style={styles.label}>MHRQI reconstructed image</Text>
            <View style={styles.previewWrap}>
              <Image
                source={{ uri: selectedRecord.mhrqiUri || selectedRecord.aiProcessedUri }}
                style={styles.previewImage}
                resizeMode="cover"
              />
            </View>

            <Text style={styles.label}>AI pipeline processed image</Text>
            <View style={styles.previewWrap}>
              <Image source={{ uri: selectedRecord.aiProcessedUri }} style={styles.previewImage} resizeMode="cover" />
            </View>

            <Pressable style={styles.primaryButton} onPress={() => exportPdf(selectedRecord)}>
              <Text style={styles.buttonText}>Export PDF for this record</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setScreen('history')}>
              <Text>Back to history</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
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
    height: CAPTURE_GUIDE_FRAME_HEIGHT,
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
    width: CAPTURE_GUIDE_CIRCLE_DIAMETER,
    height: CAPTURE_GUIDE_CIRCLE_DIAMETER,
    borderRadius: CAPTURE_GUIDE_CIRCLE_DIAMETER / 2,
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
  primaryButtonDisabled: {
    opacity: 0.55,
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
  annotationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  annotationTag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#f3f4f6',
  },
  annotationTagText: {
    fontSize: 12,
    color: '#111827',
  },
  warningBox: {
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#fffbeb',
  },
  warningTitle: {
    fontWeight: '700',
    color: '#92400e',
  },
  warningText: {
    fontSize: 13,
    color: '#92400e',
  },
  previewWrap: {
    marginTop: 6,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#111827',
    width: '100%',
    aspectRatio: 1,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
});
