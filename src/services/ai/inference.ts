import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';

import { getInferenceBootstrapStatus, getModelFileUri } from './registry';
import { FundusModelOutput } from './types';
import { base64ToBytes } from '../../utils/base64';

type TensorflowModel = {
  run(input: ArrayBufferView[]): Promise<TypedArray[]>;
};

type TypedArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | BigInt64Array
  | BigUint64Array;

type TfliteApi = {
  loadTensorflowModel: (
    source: { url: string } | number,
    delegate?: 'default' | 'metal' | 'core-ml' | 'nnapi' | 'android-gpu',
  ) => Promise<TensorflowModel>;
};

let drModelPromise: Promise<TensorflowModel> | null = null;
let glaucomaModelPromise: Promise<TensorflowModel> | null = null;
let tfliteApiCache: TfliteApi | null = null;

const DR_MODEL_FILE = 'dr_aptos_mobilenet_v2.tflite';
const GLAUCOMA_MODEL_FILE = 'glaucoma_screening.tflite';

function getTfliteApi(): TfliteApi {
  if (tfliteApiCache) {
    return tfliteApiCache;
  }

  try {
    const moduleRef = require('react-native-fast-tflite') as TfliteApi;
    if (!moduleRef?.loadTensorflowModel) {
      throw new Error('loadTensorflowModel export is missing.');
    }
    tfliteApiCache = moduleRef;
    return moduleRef;
  } catch {
    throw new Error(
      'Native TFLite module is missing from this binary. Build and run a development/production client that includes react-native-fast-tflite.',
    );
  }
}

function softmax(values: number[]): number[] {
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp(v - max));
  const sum = exps.reduce((acc, value) => acc + value, 0);
  return exps.map((v) => v / (sum || 1));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function flattenNumericOutputs(outputs: TypedArray[]): number[] {
  return outputs.flatMap((tensor) => Array.from(tensor, Number));
}

async function decodeResizedImage(
  uri: string,
  width: number,
  height: number,
): Promise<jpeg.BufferRet & { base64: string }> {
  const resized = await manipulateAsync(uri, [{ resize: { width, height } }], {
    compress: 1,
    format: SaveFormat.JPEG,
    base64: true,
  });

  if (!resized.base64) {
    throw new Error('Could not load resized image bytes for model input.');
  }

  return {
    ...jpeg.decode(base64ToBytes(resized.base64), { useTArray: true }),
    base64: resized.base64,
  };
}

async function imageUriToDrModelInput(uri: string): Promise<Float32Array> {
  const decoded = await decodeResizedImage(uri, 180, 180);
  const input = new Float32Array(1 * 180 * 180 * 3);

  // The current DR artifact is a small Sequential CNN with sigmoid outputs.
  // It is typically trained with 0..1 scaling rather than ImageNet normalization.
  let outIndex = 0;
  for (let i = 0; i < decoded.data.length; i += 4) {
    input[outIndex++] = decoded.data[i] / 255;
    input[outIndex++] = decoded.data[i + 1] / 255;
    input[outIndex++] = decoded.data[i + 2] / 255;
  }

  return input;
}

async function imageUriToGlaucomaModelInput(uri: string): Promise<Float32Array> {
  const decoded = await decodeResizedImage(uri, 224, 224);
  const input = new Float32Array(1 * 224 * 224 * 3);

  // This model currently uses a single sigmoid output and is trained with 0..1 inputs.
  let outIndex = 0;
  for (let i = 0; i < decoded.data.length; i += 4) {
    input[outIndex++] = decoded.data[i] / 255;
    input[outIndex++] = decoded.data[i + 1] / 255;
    input[outIndex++] = decoded.data[i + 2] / 255;
  }

  return input;
}

function normalizeDistribution(values: number[]): number[] {
  const sum = values.reduce((acc, value) => acc + value, 0);
  if (!Number.isFinite(sum) || sum <= 0) {
    return values.map(() => 0);
  }
  return values.map((value) => value / sum);
}

function parseDrSeverityFromFiveOutputs(drOutput: number[]): { severity: 0 | 1 | 2 | 3 | 4; probability: number } {
  const rawFive = drOutput.slice(0, 5);
  const allAreProbabilities = rawFive.every((v) => v >= 0 && v <= 1);
  const probs = allAreProbabilities ? normalizeDistribution(rawFive.map(clamp01)) : softmax(rawFive);

  const severity = probs.reduce(
    (best, value, idx) => (value > probs[best] ? idx : best),
    0,
  ) as 0 | 1 | 2 | 3 | 4;

  return { severity, probability: probs[severity] ?? 0 };
}

function parseDrSeverityFromFiftyOutputs(drOutput: number[]): { severity: 0 | 1 | 2 | 3 | 4; probability: number } {
  const clipped = drOutput.slice(0, 50).map(clamp01);
  const bucketScores = [0, 0, 0, 0, 0];

  // The current model emits 50 sigmoid activations.
  // We aggregate contiguous bins into 5 grade buckets to preserve the app contract.
  for (let bucket = 0; bucket < 5; bucket += 1) {
    const start = bucket * 10;
    const end = start + 10;
    const slice = clipped.slice(start, end);
    const avg = slice.reduce((acc, value) => acc + value, 0) / Math.max(1, slice.length);
    bucketScores[bucket] = avg;
  }

  const probs = normalizeDistribution(bucketScores);
  const severity = probs.reduce(
    (best, value, idx) => (value > probs[best] ? idx : best),
    0,
  ) as 0 | 1 | 2 | 3 | 4;

  return { severity, probability: probs[severity] ?? 0 };
}

function parseDrSeverity(drOutput: number[]): { severity: 0 | 1 | 2 | 3 | 4; probability: number } {
  if (drOutput.length < 5) {
    throw new Error('DR model output tensor is invalid. Expected at least 5 values.');
  }

  if (drOutput.length >= 50) {
    return parseDrSeverityFromFiftyOutputs(drOutput);
  }

  return parseDrSeverityFromFiveOutputs(drOutput);
}

async function loadDrModel(): Promise<TensorflowModel> {
  if (!drModelPromise) {
    const { loadTensorflowModel } = getTfliteApi();
    drModelPromise = loadTensorflowModel({ url: getModelFileUri(DR_MODEL_FILE) }, 'default').catch(
      (error) => {
        drModelPromise = null;
        throw error;
      },
    );
  }
  return drModelPromise;
}

async function loadGlaucomaModel(): Promise<TensorflowModel> {
  if (!glaucomaModelPromise) {
    const { loadTensorflowModel } = getTfliteApi();
    glaucomaModelPromise = loadTensorflowModel(
      { url: getModelFileUri(GLAUCOMA_MODEL_FILE) },
      'default',
    ).catch((error) => {
      glaucomaModelPromise = null;
      throw error;
    });
  }
  return glaucomaModelPromise;
}

function parseGlaucomaProbability(output: number[]): number {
  const values = output;
  if (values.length === 0) {
    throw new Error('Glaucoma model output tensor is invalid. Expected at least 1 value after flattening outputs.');
  }

  if (values.length === 1) {
    const raw = values[0] ?? 0;
    // Binary classifiers may output either a sigmoid probability or a single logit.
    return raw >= 0 && raw <= 1 ? clamp01(raw) : sigmoid(raw);
  }

  const probs = softmax(values.slice(0, 2));
  return probs[1] ?? 0;
}

function deriveRiskFromClasses(
  drSeverity: 0 | 1 | 2 | 3 | 4,
  glaucomaProbability: number,
): 'low' | 'medium' | 'high' {
  if (drSeverity >= 3 || glaucomaProbability >= 0.85) {
    return 'high';
  }
  if (drSeverity >= 1 || glaucomaProbability >= 0.55) {
    return 'medium';
  }
  return 'low';
}

async function assertModelFilesReadable(): Promise<void> {
  const drInfo = await FileSystem.getInfoAsync(getModelFileUri(DR_MODEL_FILE));
  const glaucomaInfo = await FileSystem.getInfoAsync(getModelFileUri(GLAUCOMA_MODEL_FILE));

  if (!drInfo.exists || !glaucomaInfo.exists) {
    throw new Error('Required model artifacts are not present in app storage.');
  }
}

export async function runFundusModelInference(processedImageUri: string): Promise<FundusModelOutput> {
  const status = await getInferenceBootstrapStatus();

  if (status.availability !== 'ready') {
    throw new Error(status.reason ?? 'AI runtime unavailable.');
  }

  await assertModelFilesReadable();

  const [drModel, glaucomaModel, drInput, glaucomaInput] = await Promise.all([
    loadDrModel(),
    loadGlaucomaModel(),
    imageUriToDrModelInput(processedImageUri),
    imageUriToGlaucomaModelInput(processedImageUri),
  ]);

  const drOutputs = await drModel.run([drInput]);
  const glaucomaOutputs = await glaucomaModel.run([glaucomaInput]);

  if (drOutputs.length === 0 || glaucomaOutputs.length === 0) {
    throw new Error('Model inference returned empty output tensors.');
  }

  const drValues = flattenNumericOutputs(drOutputs);
  const glaucomaValues = flattenNumericOutputs(glaucomaOutputs);

  if (drValues.length < 5) {
    throw new Error(
      `DR model output tensor is invalid. Expected at least 5 values after flattening outputs, got ${drValues.length} across ${drOutputs.length} tensor(s).`,
    );
  }

  if (glaucomaValues.length < 1) {
    throw new Error(
      `Glaucoma model output tensor is invalid. Expected at least 1 value after flattening outputs, got ${glaucomaValues.length} across ${glaucomaOutputs.length} tensor(s).`,
    );
  }

  const drParsed = parseDrSeverity(drValues);
  const glaucomaProbability = parseGlaucomaProbability(glaucomaValues);

  const riskLevel = deriveRiskFromClasses(drParsed.severity, glaucomaProbability);
  const drOutputMode = drValues.length >= 50 ? '50-bin sigmoid aggregated to 5-grade' : '5-grade direct';
  const markerSummary =
    `DR grade ${drParsed.severity} (p=${Math.round(drParsed.probability * 100)}%, ${drOutputMode}), ` +
    `glaucoma probability ${Math.round(glaucomaProbability * 100)}%`;

  return {
    diabeticRetinopathy: drParsed.probability,
    hypertensionRetinopathy: null,
    glaucomaSigns: glaucomaProbability,
    drSeverity: drParsed.severity,
    riskLevel,
    markerSummary,
    source: 'model',
  };
}
