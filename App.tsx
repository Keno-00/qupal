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
  glaucomaLabel: 'Referable Glaucoma' | 'Non-Referable Glaucoma' | null;
  glaucomaConfidence: number | null;
  estimatedCdr: number | null;
  glaucomaSeverity: 'mild' | 'moderate' | 'severe' | null;
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
const SCREEN_TITLES: Record<Screen, string> = {
  setup: 'Patient Setup',
  capture: 'Image Capture',
  review: 'Review & Queue',
  report: 'Assessment Report',
  history: 'Progression Tracking',
  record: 'Record Details',
};

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

function riskTone(riskLevel: AnalysisResult['riskLevel']): {
  label: string;
  textColor: string;
  backgroundColor: string;
  borderColor: string;
} {
  if (riskLevel === 'high') {
    return {
      label: 'High risk',
      textColor: '#9f1239',
      backgroundColor: '#ffe4e6',
      borderColor: '#fecdd3',
    };
  }
  if (riskLevel === 'medium') {
    return {
      label: 'Medium risk',
      textColor: '#92400e',
      backgroundColor: '#fef3c7',
      borderColor: '#fde68a',
    };
  }
  return {
    label: 'Low risk',
    textColor: '#166534',
    backgroundColor: '#dcfce7',
    borderColor: '#bbf7d0',
  };
}

function trendTone(trend: Trend): {
  label: string;
  textColor: string;
  backgroundColor: string;
  borderColor: string;
} {
  if (trend === 'worsening') {
    return {
      label: 'Worsening',
      textColor: '#9f1239',
      backgroundColor: '#ffe4e6',
      borderColor: '#fecdd3',
    };
  }
  if (trend === 'improving') {
    return {
      label: 'Improving',
      textColor: '#166534',
      backgroundColor: '#dcfce7',
      borderColor: '#bbf7d0',
    };
  }
  if (trend === 'stable') {
    return {
      label: 'Stable',
      textColor: '#0f766e',
      backgroundColor: '#ccfbf1',
      borderColor: '#99f6e4',
    };
  }
  return {
    label: 'Baseline',
    textColor: '#1e3a8a',
    backgroundColor: '#dbeafe',
    borderColor: '#bfdbfe',
  };
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inferMimeType(uri: string): string {
  const match = uri.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/);
  const ext = match?.[1] ?? '';
  if (ext === 'png') {
    return 'image/png';
  }
  if (ext === 'webp') {
    return 'image/webp';
  }
  return 'image/jpeg';
}

async function uriToDataUri(uri: string): Promise<string | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return `data:${inferMimeType(uri)};base64,${base64}`;
  } catch {
    return null;
  }
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

  const refreshInferenceBootstrap = async (forceRedownload = false) => {
    setIsRetryingAiSetup(true);
    try {
      await prepareInferenceRuntime({ forceRedownload });
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
                glaucomaLabel:
                  record.analysis?.glaucomaLabel === 'Referable Glaucoma' ||
                  record.analysis?.glaucomaLabel === 'Non-Referable Glaucoma'
                    ? record.analysis.glaucomaLabel
                    : ((record.analysis?.glaucomaSigns ?? 0) > 0.5
                      ? 'Referable Glaucoma'
                      : 'Non-Referable Glaucoma'),
                glaucomaConfidence:
                  typeof record.analysis?.glaucomaConfidence === 'number'
                    ? record.analysis.glaucomaConfidence
                    : (typeof record.analysis?.glaucomaSigns === 'number'
                      ? Math.max(record.analysis.glaucomaSigns, 1 - record.analysis.glaucomaSigns)
                      : null),
                estimatedCdr:
                  typeof record.analysis?.estimatedCdr === 'number'
                    ? record.analysis.estimatedCdr
                    : null,
                glaucomaSeverity:
                  record.analysis?.glaucomaSeverity === 'mild' ||
                  record.analysis?.glaucomaSeverity === 'moderate' ||
                  record.analysis?.glaucomaSeverity === 'severe'
                    ? record.analysis.glaucomaSeverity
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

  const currentScreenTitle = SCREEN_TITLES[screen];
  const runtimeReady = inferenceBootstrap.availability === 'ready';

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

      if (!mhrqiPass.denoisedUri) {
        throw new Error('MHRQI preprocessing did not produce a denoised output image for AI inference.');
      }

      const modelOutput = await runFundusModelInference(mhrqiPass.denoisedUri);

      const diabetic = modelOutput.diabeticRetinopathy;
      const hyper = modelOutput.hypertensionRetinopathy;
      const glaucoma = modelOutput.glaucomaSigns;
      const maxProbability = Math.max(diabetic, hyper ?? 0, glaucoma);

      const result: AnalysisResult = {
        diabeticRetinopathy: diabetic,
        hypertensionRetinopathy: hyper,
        glaucomaSigns: glaucoma,
        glaucomaLabel: modelOutput.glaucomaLabel,
        glaucomaConfidence: modelOutput.glaucomaConfidence,
        estimatedCdr: modelOutput.estimatedCdr,
        glaucomaSeverity: modelOutput.glaucomaSeverity,
        riskLevel: modelOutput.riskLevel,
        drSeverity: modelOutput.drSeverity,
        source: modelOutput.source,
      };

      const summary = modelOutput.markerSummary || 'Model did not provide marker summary.';
      const aiProcessedUri = modelOutput.glaucomaOverlayUri ?? mhrqiPass.denoisedUri;
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
        aiProcessedUri,
        mhrqiUri: mhrqiPass.mhrqiUri,
        processedUri: aiProcessedUri,
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
        mhrqiUri: mhrqiPass.mhrqiUri,
        processedUri: aiProcessedUri,
        analysis: result,
        markerSummary: summary,
        trend,
      });

      setProcessedUri(aiProcessedUri);
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

    const imageCandidates: { label: string; uri: string }[] = [
      { label: 'Original fundus capture', uri: record.rawUri },
      { label: 'MHRQI reconstructed image', uri: record.mhrqiUri || record.aiProcessedUri },
      { label: 'AI pipeline processed image', uri: record.aiProcessedUri },
      { label: 'Processed image', uri: record.processedUri },
    ];

    const uniqueImageCandidates = imageCandidates.filter((candidate, index, all) => {
      return all.findIndex((entry) => entry.uri === candidate.uri) === index;
    });

    const embeddedImages = await Promise.all(
      uniqueImageCandidates.map(async (candidate) => {
        const dataUri = await uriToDataUri(candidate.uri);
        return {
          ...candidate,
          dataUri,
        };
      }),
    );

    const imagesHtml = embeddedImages
      .map((entry) => {
        if (!entry.dataUri) {
          return `
            <section class="image-card">
              <h3>${escapeHtml(entry.label)}</h3>
              <p class="image-missing">Image unavailable in local storage.</p>
            </section>
          `;
        }

        return `
          <section class="image-card">
            <h3>${escapeHtml(entry.label)}</h3>
            <img src="${entry.dataUri}" alt="${escapeHtml(entry.label)}" />
          </section>
        `;
      })
      .join('');

    const html = `
      <html>
        <head>
          <style>
            body {
              font-family: sans-serif;
              padding: 16px;
              color: #111827;
            }
            h2 {
              margin-bottom: 8px;
            }
            .image-card {
              margin-top: 18px;
              page-break-inside: avoid;
            }
            .image-card h3 {
              margin: 0 0 8px;
              font-size: 14px;
            }
            .image-card img {
              width: 100%;
              max-height: 380px;
              object-fit: contain;
              border: 1px solid #d1d5db;
              border-radius: 6px;
              background: #f9fafb;
            }
            .image-missing {
              font-size: 12px;
              color: #6b7280;
              margin: 0;
            }
            .disclaimer {
              font-size: 12px;
            }
          </style>
        </head>
        <body style="font-family: sans-serif; padding: 16px;">
          <h2>Preliminary Ocular Risk Assessment</h2>
          <p><b>Patient code:</b> ${escapeHtml(record.patientCode)}</p>
          <p><b>Capture time:</b> ${new Date(record.capturedAt).toLocaleString()}</p>
          <p><b>Eye side:</b> ${escapeHtml(record.eyeSide)}</p>
          <p><b>Risk level:</b> ${escapeHtml(record.analysis.riskLevel)}</p>
          <p><b>Marker summary:</b> ${escapeHtml(record.markerSummary)}</p>
          <p><b>Detailed probabilities</b></p>
          <ul>
            <li>Diabetic retinopathy pattern: ${formatPct(record.analysis.diabeticRetinopathy)}</li>
            <li>Hypertension retinopathy pattern: ${formatNullablePct(record.analysis.hypertensionRetinopathy)}</li>
            <li>Glaucoma-related pattern: ${formatPct(record.analysis.glaucomaSigns)}</li>
            <li>Glaucoma label: ${escapeHtml(record.analysis.glaucomaLabel ?? 'n/a')}</li>
            <li>Glaucoma confidence: ${record.analysis.glaucomaConfidence === null ? 'n/a' : formatPct(record.analysis.glaucomaConfidence)}</li>
            <li>Estimated CDR: ${record.analysis.estimatedCdr === null ? 'n/a' : record.analysis.estimatedCdr.toFixed(2)}</li>
            <li>Glaucoma severity: ${escapeHtml(record.analysis.glaucomaSeverity ?? 'n/a')}</li>
          </ul>
          <p><b>Trend:</b> ${escapeHtml(record.trend)}</p>

          <h2>Clinical Images</h2>
          ${imagesHtml}

          <hr/>
          <p class="disclaimer">Disclaimer: This is a functionality-stage preliminary pre-diagnosis support output for clinician review and not a definitive diagnosis.</p>
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
        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>GLANCE Clinical Assistant</Text>
          <Text style={styles.heroTitle}>{currentScreenTitle}</Text>
          <Text style={styles.heroSubtitle}>
            On-device retinal capture, preprocessing, and risk triage workflow
          </Text>

          <View style={styles.heroMetaRow}>
            <View
              style={[
                styles.badge,
                runtimeReady ? styles.badgeSuccess : styles.badgeWarning,
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  runtimeReady ? styles.badgeTextSuccess : styles.badgeTextWarning,
                ]}
              >
                {runtimeReady ? 'AI runtime ready' : 'AI runtime unavailable'}
              </Text>
            </View>

            <View style={[styles.badge, styles.badgeNeutral]}>
              <Text style={[styles.badgeText, styles.badgeTextNeutral]}>
                {`Saved scans ${records.length}`}
              </Text>
            </View>

            <View style={[styles.badge, styles.badgeNeutral]}>
              <Text style={[styles.badgeText, styles.badgeTextNeutral]}>
                {`Queue ${queue.length}`}
              </Text>
            </View>
          </View>
        </View>

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
                    void refreshInferenceBootstrap(true);
                  }}
                  disabled={isRetryingAiSetup}
                >
                  <Text>{isRetryingAiSetup ? 'Refreshing models...' : 'Retry AI setup (refresh models)'}</Text>
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
                  void refreshInferenceBootstrap(true);
                }}
                disabled={isRetryingAiSetup}
              >
                <Text>{isRetryingAiSetup ? 'Refreshing models...' : 'Retry AI setup (refresh models)'}</Text>
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
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: riskTone(analysis.riskLevel).backgroundColor,
                  borderColor: riskTone(analysis.riskLevel).borderColor,
                },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  { color: riskTone(analysis.riskLevel).textColor },
                ]}
              >
                {riskTone(analysis.riskLevel).label}
              </Text>
            </View>
            <Text style={styles.body}>Patient: {patientCode}</Text>
            <Text style={styles.body}>Eye: {eyeSide}</Text>
            <Text style={styles.body}>Risk level: {analysis.riskLevel}</Text>
            <Text style={styles.body}>DR severity class: {analysis.drSeverity ?? 'n/a'}</Text>
            <Text style={styles.body}>DR probability: {formatPct(analysis.diabeticRetinopathy)}</Text>
            <Text style={styles.body}>HTN probability: {formatNullablePct(analysis.hypertensionRetinopathy)}</Text>
            <Text style={styles.body}>Glaucoma probability: {formatPct(analysis.glaucomaSigns)}</Text>
            <Text style={styles.body}>Glaucoma label: {analysis.glaucomaLabel ?? 'n/a'}</Text>
            <Text style={styles.body}>
              Glaucoma confidence: {analysis.glaucomaConfidence === null ? 'n/a' : formatPct(analysis.glaucomaConfidence)}
            </Text>
            <Text style={styles.body}>
              Estimated CDR: {analysis.estimatedCdr === null ? 'n/a' : analysis.estimatedCdr.toFixed(2)}
            </Text>
            <Text style={styles.body}>Glaucoma severity: {analysis.glaucomaSeverity ?? 'n/a'}</Text>
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
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${Math.round(job.progress * 100)}%` },
                    ]}
                  />
                </View>

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
                    <Text style={styles.historyText}>Glaucoma label: {job.analysis.glaucomaLabel ?? 'n/a'}</Text>
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
                <View style={styles.rowBetween}>
                  <Text style={styles.historyText}>Patient: {r.patientCode}</Text>
                  <View
                    style={[
                      styles.badge,
                      {
                        backgroundColor: riskTone(r.analysis.riskLevel).backgroundColor,
                        borderColor: riskTone(r.analysis.riskLevel).borderColor,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        { color: riskTone(r.analysis.riskLevel).textColor },
                      ]}
                    >
                      {riskTone(r.analysis.riskLevel).label}
                    </Text>
                  </View>
                </View>
                <Text style={styles.historyText}>Date: {new Date(r.capturedAt).toLocaleString()}</Text>
                <Text style={styles.historyText}>Eye: {r.eyeSide}</Text>
                <Text style={styles.historyText}>Risk: {r.analysis.riskLevel}</Text>
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: trendTone(r.trend).backgroundColor,
                      borderColor: trendTone(r.trend).borderColor,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      { color: trendTone(r.trend).textColor },
                    ]}
                  >
                    {`Trend ${trendTone(r.trend).label}`}
                  </Text>
                </View>
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
            <View style={styles.row}>
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor: riskTone(selectedRecord.analysis.riskLevel).backgroundColor,
                    borderColor: riskTone(selectedRecord.analysis.riskLevel).borderColor,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    { color: riskTone(selectedRecord.analysis.riskLevel).textColor },
                  ]}
                >
                  {riskTone(selectedRecord.analysis.riskLevel).label}
                </Text>
              </View>
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor: trendTone(selectedRecord.trend).backgroundColor,
                    borderColor: trendTone(selectedRecord.trend).borderColor,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    { color: trendTone(selectedRecord.trend).textColor },
                  ]}
                >
                  {`Trend ${trendTone(selectedRecord.trend).label}`}
                </Text>
              </View>
            </View>
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
            <Text style={styles.body}>Glaucoma label: {selectedRecord.analysis.glaucomaLabel ?? 'n/a'}</Text>
            <Text style={styles.body}>
              Glaucoma confidence: {selectedRecord.analysis.glaucomaConfidence === null ? 'n/a' : formatPct(selectedRecord.analysis.glaucomaConfidence)}
            </Text>
            <Text style={styles.body}>
              Estimated CDR: {selectedRecord.analysis.estimatedCdr === null ? 'n/a' : selectedRecord.analysis.estimatedCdr.toFixed(2)}
            </Text>
            <Text style={styles.body}>Glaucoma severity: {selectedRecord.analysis.glaucomaSeverity ?? 'n/a'}</Text>
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
    backgroundColor: '#eef2ff',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 14,
  },
  heroCard: {
    backgroundColor: '#0f172a',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    shadowColor: '#020617',
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    gap: 6,
  },
  heroEyebrow: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#f8fafc',
  },
  heroSubtitle: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 18,
  },
  heroMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  body: {
    fontSize: 14,
    color: '#1e293b',
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
    color: '#0f172a',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  toggleButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
  },
  toggleButtonActive: {
    backgroundColor: '#dbeafe',
    borderColor: '#93c5fd',
  },
  guideBox: {
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#eff6ff',
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
    backgroundColor: '#0f172a',
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: '#0b1220',
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: '#f8fafc',
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 14,
  },
  historyItem: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 12,
    gap: 4,
    backgroundColor: '#f8fafc',
  },
  historyText: {
    fontSize: 13,
    color: '#1e293b',
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeNeutral: {
    backgroundColor: '#e2e8f0',
    borderColor: '#cbd5e1',
  },
  badgeSuccess: {
    backgroundColor: '#dcfce7',
    borderColor: '#bbf7d0',
  },
  badgeWarning: {
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  badgeTextNeutral: {
    color: '#334155',
  },
  badgeTextSuccess: {
    color: '#166534',
  },
  badgeTextWarning: {
    color: '#92400e',
  },
  progressTrack: {
    width: '100%',
    height: 7,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
    marginTop: 2,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 999,
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
    borderRadius: 12,
    padding: 12,
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
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
    width: '100%',
    aspectRatio: 1,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
});
