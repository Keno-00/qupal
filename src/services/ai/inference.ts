import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';

import { getInferenceBootstrapStatus, getModelFileUri } from './registry';
import { FundusModelOutput } from './types';
import {
  classifyGlaucomaLikeSource,
  glaucomaSeverityFromCdr,
  InferenceTensor,
  parseGlaucomaProbabilityLikeSource,
} from './outputParsing';
import { base64ToBytes, bytesToBase64 } from '../../utils/base64';

type TensorflowModel = {
  run(input: ArrayBufferView[]): Promise<InferenceTensor[]>;
};

type TfliteApi = {
  loadTensorflowModel: (
    source: { url: string } | number,
    delegate?: 'default' | 'metal' | 'core-ml' | 'nnapi' | 'android-gpu',
  ) => Promise<TensorflowModel>;
};

let drModelPromise: Promise<TensorflowModel> | null = null;
let glaucomaModelPromise: Promise<TensorflowModel> | null = null;
let glaucomaSegmentationModelPromise: Promise<TensorflowModel | null> | null = null;
let tfliteApiCache: TfliteApi | null = null;

const DR_MODEL_FILE = 'dr_aptos_mobilenet_v2.tflite';
const GLAUCOMA_MODEL_FILE = 'glaucoma_screening.tflite';
const GLAUCOMA_SEGMENTATION_MODEL_FILE = 'glaucoma_odoc_segmentation.tflite';
const DR_INPUT_SIZE = 224;
const DR_SOURCE_CONFIDENCE_THRESHOLD = 0.1;

type SegmentationRuntimeConfig = {
  inputSize: number;
  discClassIndex: number;
  cupClassIndex: number;
};

function getSegmentationRuntimeConfig(): SegmentationRuntimeConfig {
  const raw = (Constants.expoConfig?.extra as {
    aiModels?: {
      glaucomaSegmentationConfig?: {
        inputSize?: number;
        discClassIndex?: number;
        cupClassIndex?: number;
      };
    };
  } | undefined)?.aiModels?.glaucomaSegmentationConfig;

  return {
    inputSize: typeof raw?.inputSize === 'number' && raw.inputSize >= 64 ? raw.inputSize : 224,
    discClassIndex:
      typeof raw?.discClassIndex === 'number' && raw.discClassIndex >= 0 ? raw.discClassIndex : 1,
    cupClassIndex:
      typeof raw?.cupClassIndex === 'number' && raw.cupClassIndex >= 0 ? raw.cupClassIndex : 2,
  };
}

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

function selectPrimaryOutputTensor(outputs: InferenceTensor[]): InferenceTensor {
  if (outputs.length === 0) {
    throw new Error('Model inference returned empty output tensors.');
  }

  // Source repos use a single output tensor and read from that tensor directly.
  return outputs[0];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function normalizeUriPathSeparators(value: string): string {
  return value.replace(/\\/g, '/');
}

function assertDrInputMustComeFromMhrqi(uri: string): void {
  const normalized = normalizeUriPathSeparators(uri).toLowerCase();
  const isMhrqiDenoised =
    normalized.includes('/mhrqi/') &&
    /\/mhrqi-denoised-.*\.(bmp|png|jpe?g)(\?.*)?$/.test(normalized);

  if (!isMhrqiDenoised) {
    throw new Error(
      `ABSOLUTE DR INPUT VIOLATION: expected MHRQI denoised artifact URI (*/mhrqi/mhrqi-denoised-*.bmp|png|jpg), received: ${uri}`,
    );
  }
}

function assertDrDecodedImageShape(decoded: DecodedImage): void {
  if (decoded.width !== DR_INPUT_SIZE || decoded.height !== DR_INPUT_SIZE) {
    throw new Error(
      `ABSOLUTE DR INPUT VIOLATION: expected MHRQI DR input to be ${DR_INPUT_SIZE}x${DR_INPUT_SIZE} after resize, got ${decoded.width}x${decoded.height}.`,
    );
  }
}

function assertDecodedImageIsGrayscale(decoded: DecodedImage): void {
  for (let i = 0; i < decoded.data.length; i += 4) {
    const r = decoded.data[i] ?? 0;
    const g = decoded.data[i + 1] ?? 0;
    const b = decoded.data[i + 2] ?? 0;

    // JPEG decode can introduce tiny channel divergence; tolerate 2 luma levels.
    if (Math.abs(r - g) > 2 || Math.abs(g - b) > 2 || Math.abs(r - b) > 2) {
      throw new Error(
        'ABSOLUTE DR INPUT VIOLATION: DR path requires grayscale MHRQI output. Found non-grayscale RGB channels.',
      );
    }
  }
}

function normalizeDrTensorValuesLikeSource(tensor: InferenceTensor, values: number[]): number[] {
  if (tensor instanceof Uint8Array) {
    return values.map((v) => v / 255);
  }
  if (tensor instanceof Int8Array) {
    return values.map((v) => (v + 128) / 255);
  }
  return values;
}

function parseDrSeveritySourceCompatibleForDownstream(drOutputTensor: InferenceTensor): {
  severity: 0 | 1 | 2 | 3 | 4;
  probability: number;
} {
  const rawValues = Array.from(drOutputTensor, Number);
  const values = normalizeDrTensorValuesLikeSource(drOutputTensor, rawValues);

  if (values.length < 5) {
    throw new Error('DR model output tensor is invalid. Expected at least 5 values.');
  }

  const classScores = values.slice(0, 5);
  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < classScores.length; i += 1) {
    const score = classScores[i] ?? Number.NEGATIVE_INFINITY;
    if (score > DR_SOURCE_CONFIDENCE_THRESHOLD && score > bestScore) {
      bestIndex = i;
      bestScore = score;
    }
  }

  if (bestIndex < 0) {
    throw new Error(
      `ABSOLUTE DR OUTPUT VIOLATION: no DR class exceeded source threshold ${DR_SOURCE_CONFIDENCE_THRESHOLD}.`,
    );
  }

  return {
    severity: bestIndex as 0 | 1 | 2 | 3 | 4,
    probability: clamp01(bestScore),
  };
}

type DecodedImage = {
  width: number;
  height: number;
  data: Uint8Array;
  base64: string;
};

async function decodeResizedImage(
  uri: string,
  width: number,
  height: number,
): Promise<DecodedImage> {
  const resized = await manipulateAsync(uri, [{ resize: { width, height } }], {
    compress: 1,
    format: SaveFormat.JPEG,
    base64: true,
  });

  if (!resized.base64) {
    throw new Error('Could not load resized image bytes for model input.');
  }

  const decoded = jpeg.decode(base64ToBytes(resized.base64), { useTArray: true });

  return {
    width: decoded.width,
    height: decoded.height,
    data: decoded.data as Uint8Array,
    base64: resized.base64,
  };
}

async function imageUriToDrModelInput(uri: string): Promise<Float32Array> {
  assertDrInputMustComeFromMhrqi(uri);

  const decoded = await decodeResizedImage(uri, DR_INPUT_SIZE, DR_INPUT_SIZE);
  assertDrDecodedImageShape(decoded);
  assertDecodedImageIsGrayscale(decoded);

  const input = new Float32Array(1 * DR_INPUT_SIZE * DR_INPUT_SIZE * 3);

  // MHRQI output is grayscale already. Keep only resize + [0,1] normalization.
  // Replicate gray into RGB channels for model tensor layout.
  let outIndex = 0;
  for (let i = 0; i < decoded.data.length; i += 4) {
    const r = decoded.data[i] ?? 0;
    const g = decoded.data[i + 1] ?? 0;
    const b = decoded.data[i + 2] ?? 0;
    const gray = (r + g + b) / 3 / 255;
    input[outIndex++] = gray;
    input[outIndex++] = gray;
    input[outIndex++] = gray;
  }

  return input;
}

async function imageUriToGlaucomaModelInput(uri: string): Promise<Float32Array> {
  const decoded = await decodeResizedImage(uri, 224, 224);
  const input = new Float32Array(1 * 224 * 224 * 3);

  // Glaucoma source app.py uses np.array(img)/255.0 with no mean/std transform.
  let outIndex = 0;
  for (let i = 0; i < decoded.data.length; i += 4) {
    input[outIndex++] = decoded.data[i] / 255;
    input[outIndex++] = decoded.data[i + 1] / 255;
    input[outIndex++] = decoded.data[i + 2] / 255;
  }

  return input;
}

async function imageUriToRgbModelInput(uri: string, side: number): Promise<Float32Array> {
  const decoded = await decodeResizedImage(uri, side, side);
  const input = new Float32Array(1 * side * side * 3);

  let outIndex = 0;
  for (let i = 0; i < decoded.data.length; i += 4) {
    input[outIndex++] = decoded.data[i] / 255;
    input[outIndex++] = decoded.data[i + 1] / 255;
    input[outIndex++] = decoded.data[i + 2] / 255;
  }

  return input;
}

type BinaryComponent = {
  area: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type CdrEstimation = {
  cdr: number;
  disc: BinaryComponent | null;
  cup: BinaryComponent | null;
};

function componentCenter(component: BinaryComponent): { x: number; y: number } {
  return {
    x: (component.minX + component.maxX) / 2,
    y: (component.minY + component.maxY) / 2,
  };
}

function componentDiameter(component: BinaryComponent): number {
  const w = component.maxX - component.minX + 1;
  const h = component.maxY - component.minY + 1;
  return Math.max(w, h);
}

function percentile(values: Uint8Array, q: number): number {
  if (values.length === 0) {
    return 0;
  }

  const bucket = new Array<number>(256).fill(0);
  for (let i = 0; i < values.length; i += 1) {
    bucket[values[i]] += 1;
  }

  const target = Math.max(0, Math.min(values.length - 1, Math.floor((values.length - 1) * q)));
  let seen = 0;
  for (let v = 0; v < 256; v += 1) {
    seen += bucket[v];
    if (seen > target) {
      return v;
    }
  }

  return 255;
}

function rectContains(outer: BinaryComponent, inner: BinaryComponent): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY &&
    inner.maxY <= outer.maxY
  );
}

function selectDiscCandidate(
  components: BinaryComponent[],
  width: number,
  height: number,
): BinaryComponent | null {
  const imageArea = width * height;
  const centerX = width / 2;
  const centerY = height / 2;
  const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);

  let best: BinaryComponent | null = null;
  let bestScore = -Infinity;

  for (let i = 0; i < components.length; i += 1) {
    const c = components[i];
    const areaRatio = c.area / imageArea;

    // Disc should be localized, not tiny, not near full-frame.
    if (areaRatio < 0.01 || areaRatio > 0.55) {
      continue;
    }

    const cc = componentCenter(c);
    const distance = Math.sqrt((cc.x - centerX) ** 2 + (cc.y - centerY) ** 2);
    const centerScore = 1 - distance / maxDistance;

    // Favor disc-ish size around ~12% image area.
    const sizeScore = 1 - Math.min(1, Math.abs(areaRatio - 0.12) / 0.12);
    const score = centerScore * 0.65 + sizeScore * 0.35;

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
}

function selectCupCandidate(
  components: BinaryComponent[],
  disc: BinaryComponent,
): BinaryComponent | null {
  const discArea = Math.max(1, disc.area);
  const discCenter = componentCenter(disc);

  let best: BinaryComponent | null = null;
  let bestScore = -Infinity;

  for (let i = 0; i < components.length; i += 1) {
    const c = components[i];
    const areaRatio = c.area / discArea;

    if (areaRatio < 0.02 || areaRatio > 0.7) {
      continue;
    }
    if (!rectContains(disc, c)) {
      continue;
    }

    const cc = componentCenter(c);
    const distance = Math.sqrt((cc.x - discCenter.x) ** 2 + (cc.y - discCenter.y) ** 2);
    const discDiameter = Math.max(1, componentDiameter(disc));
    const centerScore = 1 - Math.min(1, distance / (discDiameter / 2));

    // Favor cup area around ~30% of disc area.
    const sizeScore = 1 - Math.min(1, Math.abs(areaRatio - 0.3) / 0.3);
    const score = centerScore * 0.7 + sizeScore * 0.3;

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
}

function findBinaryComponents(binary: Uint8Array, width: number, height: number): BinaryComponent[] {
  const visited = new Uint8Array(width * height);
  const components: BinaryComponent[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (visited[start] === 1 || binary[start] === 0) {
        continue;
      }

      let area = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      const stack = [start];
      visited[start] = 1;

      while (stack.length > 0) {
        const idx = stack.pop()!;
        const cy = Math.floor(idx / width);
        const cx = idx - cy * width;

        area += 1;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        const neighbors = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];

        for (let i = 0; i < neighbors.length; i += 1) {
          const nx = neighbors[i][0];
          const ny = neighbors[i][1];
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            continue;
          }
          const nidx = ny * width + nx;
          if (visited[nidx] === 1 || binary[nidx] === 0) {
            continue;
          }
          visited[nidx] = 1;
          stack.push(nidx);
        }
      }

      components.push({ area, minX, maxX, minY, maxY });
    }
  }

  return components;
}

function tensorToNumberArray(tensor: InferenceTensor): number[] {
  if (tensor instanceof Uint8Array) {
    return Array.from(tensor, (v) => v / 255);
  }
  if (tensor instanceof Int8Array) {
    return Array.from(tensor, (v) => (v + 128) / 255);
  }
  return Array.from(tensor, Number);
}

function componentsFromClassMap(
  classMap: Uint8Array,
  width: number,
  height: number,
  classIndex: number,
): BinaryComponent[] {
  const binary = new Uint8Array(width * height);
  for (let i = 0; i < classMap.length; i += 1) {
    binary[i] = classMap[i] === classIndex ? 1 : 0;
  }
  return findBinaryComponents(binary, width, height).sort((a, b) => b.area - a.area);
}

function estimateCdrFromSegmentationTensor(
  outputTensor: InferenceTensor,
  side: number,
  config: SegmentationRuntimeConfig,
): CdrEstimation | null {
  const values = tensorToNumberArray(outputTensor);
  const pixelCount = side * side;
  if (pixelCount <= 0 || values.length < pixelCount * 2 || values.length % pixelCount !== 0) {
    return null;
  }

  const classCount = Math.floor(values.length / pixelCount);
  const maxClassIdx = Math.max(config.discClassIndex, config.cupClassIndex);
  if (classCount <= maxClassIdx) {
    return null;
  }

  // Assumes NHWC-style flattening from TFLite: [H, W, C] per pixel logits/probabilities.
  const classMap = new Uint8Array(pixelCount);
  for (let p = 0; p < pixelCount; p += 1) {
    let bestClass = 0;
    let bestScore = values[p * classCount] ?? Number.NEGATIVE_INFINITY;
    for (let c = 1; c < classCount; c += 1) {
      const score = values[p * classCount + c] ?? Number.NEGATIVE_INFINITY;
      if (score > bestScore) {
        bestScore = score;
        bestClass = c;
      }
    }
    classMap[p] = bestClass;
  }

  const discCandidates = componentsFromClassMap(classMap, side, side, config.discClassIndex);
  const cupCandidates = componentsFromClassMap(classMap, side, side, config.cupClassIndex);

  const disc = selectDiscCandidate(discCandidates, side, side);
  if (!disc) {
    return null;
  }

  const cup = selectCupCandidate(cupCandidates, disc);
  if (!cup) {
    return { cdr: 0.5, disc, cup: null };
  }

  const discDiameter = componentDiameter(disc);
  const cupDiameter = componentDiameter(cup);
  if (discDiameter <= 0) {
    return { cdr: 0.5, disc, cup: null };
  }

  return {
    cdr: clamp01(cupDiameter / discDiameter),
    disc,
    cup,
  };
}

function estimateCdrLikeSource(decoded: DecodedImage): CdrEstimation {
  const { width, height, data } = decoded;
  const gray = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = (y * width + x) * 4;
      const r = data[pixelIndex] ?? 0;
      const g = data[pixelIndex + 1] ?? 0;
      const b = data[pixelIndex + 2] ?? 0;
      gray[y * width + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }

  const discThreshold = percentile(gray, 0.8);
  const cupThreshold = percentile(gray, 0.92);

  const discBinary = new Uint8Array(width * height);
  const cupBinary = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i += 1) {
    const gv = gray[i];
    discBinary[i] = gv >= discThreshold ? 1 : 0;
    cupBinary[i] = gv >= cupThreshold ? 1 : 0;
  }

  const discComponents = findBinaryComponents(discBinary, width, height).sort((a, b) => b.area - a.area);
  const disc = selectDiscCandidate(discComponents, width, height);
  if (!disc) {
    return { cdr: 0.5, disc: null, cup: null };
  }

  const cupComponents = findBinaryComponents(cupBinary, width, height).sort((a, b) => b.area - a.area);
  const cup = selectCupCandidate(cupComponents, disc);
  if (!cup) {
    return { cdr: 0.5, disc, cup: null };
  }

  const discDiameter = componentDiameter(disc);
  const cupDiameter = componentDiameter(cup);

  if (discDiameter <= 0) {
    return { cdr: 0.5, disc: null, cup: null };
  }

  return {
    cdr: clamp01(cupDiameter / discDiameter),
    disc,
    cup,
  };
}

function drawRect(
  rgba: Uint8Array,
  width: number,
  height: number,
  box: BinaryComponent,
  color: [number, number, number],
  thickness = 3,
): void {
  const minX = Math.max(0, Math.min(width - 1, box.minX));
  const maxX = Math.max(0, Math.min(width - 1, box.maxX));
  const minY = Math.max(0, Math.min(height - 1, box.minY));
  const maxY = Math.max(0, Math.min(height - 1, box.maxY));

  const paint = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) {
      return;
    }
    const idx = (y * width + x) * 4;
    rgba[idx] = color[0];
    rgba[idx + 1] = color[1];
    rgba[idx + 2] = color[2];
    rgba[idx + 3] = 255;
  };

  for (let t = 0; t < thickness; t += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      paint(x, minY + t);
      paint(x, maxY - t);
    }
    for (let y = minY; y <= maxY; y += 1) {
      paint(minX + t, y);
      paint(maxX - t, y);
    }
  }
}

function scaleComponent(box: BinaryComponent, from: DecodedImage, to: DecodedImage): BinaryComponent {
  const sx = to.width / from.width;
  const sy = to.height / from.height;

  return {
    area: box.area,
    minX: Math.max(0, Math.floor(box.minX * sx)),
    maxX: Math.min(to.width - 1, Math.ceil((box.maxX + 1) * sx) - 1),
    minY: Math.max(0, Math.floor(box.minY * sy)),
    maxY: Math.min(to.height - 1, Math.ceil((box.maxY + 1) * sy) - 1),
  };
}

async function buildGlaucomaOverlayImage(
  sourceUri: string,
  cdrSourceImage: DecodedImage,
  disc: BinaryComponent | null,
  cup: BinaryComponent | null,
): Promise<string | null> {
  if (!FileSystem.documentDirectory || (!disc && !cup)) {
    return null;
  }

  const overlayDecoded = await decodeResizedImage(sourceUri, 1024, 1024);
  const rgba = new Uint8Array(overlayDecoded.data);

  if (disc) {
    drawRect(
      rgba,
      overlayDecoded.width,
      overlayDecoded.height,
      scaleComponent(disc, cdrSourceImage, overlayDecoded),
      [46, 204, 113],
      4,
    );
  }
  if (cup) {
    drawRect(
      rgba,
      overlayDecoded.width,
      overlayDecoded.height,
      scaleComponent(cup, cdrSourceImage, overlayDecoded),
      [231, 76, 60],
      4,
    );
  }

  const encoded = jpeg.encode(
    {
      data: rgba,
      width: overlayDecoded.width,
      height: overlayDecoded.height,
    },
    92,
  );

  const dir = `${FileSystem.documentDirectory}ai-processed/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const uri = `${dir}glaucoma-overlay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  await FileSystem.writeAsStringAsync(uri, bytesToBase64(encoded.data as Uint8Array), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
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

async function loadGlaucomaSegmentationModelOptional(): Promise<TensorflowModel | null> {
  if (!glaucomaSegmentationModelPromise) {
    glaucomaSegmentationModelPromise = (async () => {
      const uri = getModelFileUri(GLAUCOMA_SEGMENTATION_MODEL_FILE);
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) {
        return null;
      }

      const { loadTensorflowModel } = getTfliteApi();
      return loadTensorflowModel({ url: uri }, 'default');
    })().catch(() => {
      glaucomaSegmentationModelPromise = null;
      return null;
    });
  }
  return glaucomaSegmentationModelPromise;
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
  assertDrInputMustComeFromMhrqi(processedImageUri);

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

  const segmentationConfig = getSegmentationRuntimeConfig();
  const glaucomaDecoded = await decodeResizedImage(
    processedImageUri,
    segmentationConfig.inputSize,
    segmentationConfig.inputSize,
  );
  const glaucomaSegmentationModel = await loadGlaucomaSegmentationModelOptional();

  const drOutputs = await drModel.run([drInput]);
  const glaucomaOutputs = await glaucomaModel.run([glaucomaInput]);

  const drPrimaryOutput = selectPrimaryOutputTensor(drOutputs);
  const glaucomaPrimaryOutput = selectPrimaryOutputTensor(glaucomaOutputs);

  const drParsed = parseDrSeveritySourceCompatibleForDownstream(drPrimaryOutput);
  const glaucomaProbability = parseGlaucomaProbabilityLikeSource(glaucomaPrimaryOutput);
  const glaucomaLabel = classifyGlaucomaLikeSource(glaucomaProbability);
  const glaucomaConfidence =
    glaucomaLabel === 'Referable Glaucoma' ? glaucomaProbability : 1 - glaucomaProbability;
  let cdrEstimation: CdrEstimation | null = null;
  let cdrSource: 'segmentation-model' | 'heuristic' = 'heuristic';

  if (glaucomaSegmentationModel) {
    const segInput = await imageUriToRgbModelInput(processedImageUri, segmentationConfig.inputSize);
    const segOutputs = await glaucomaSegmentationModel.run([segInput]);
    const segPrimaryOutput = selectPrimaryOutputTensor(segOutputs);
    cdrEstimation = estimateCdrFromSegmentationTensor(
      segPrimaryOutput,
      segmentationConfig.inputSize,
      segmentationConfig,
    );
    if (cdrEstimation) {
      cdrSource = 'segmentation-model';
    }
  }

  if (!cdrEstimation) {
    cdrEstimation = estimateCdrLikeSource(glaucomaDecoded);
    cdrSource = 'heuristic';
  }

  const estimatedCdr = cdrEstimation.cdr;
  const glaucomaSeverity = glaucomaSeverityFromCdr(estimatedCdr);
  const glaucomaOverlayUri = await buildGlaucomaOverlayImage(
    processedImageUri,
    glaucomaDecoded,
    cdrEstimation.disc,
    cdrEstimation.cup,
  );

  const riskLevel = deriveRiskFromClasses(drParsed.severity, glaucomaProbability);
  const drOutputMode = `source-compatible thresholded class confidence (>${DR_SOURCE_CONFIDENCE_THRESHOLD})`;
  const drTensorShape = drOutputs.map((tensor) => tensor.length).join('/');
  const glaucomaTensorShape = glaucomaOutputs.map((tensor) => tensor.length).join('/');
  const markerSummary =
    `DR grade ${drParsed.severity} (p=${Math.round(drParsed.probability * 100)}%, ${drOutputMode}), ` +
    `glaucoma ${glaucomaLabel} (${Math.round(glaucomaConfidence * 100)}% confidence, CDR ${estimatedCdr.toFixed(2)}, severity ${glaucomaSeverity}, CDR source ${cdrSource}) | ` +
    `tensors DR:${drTensorShape} GL:${glaucomaTensorShape}`;

  return {
    diabeticRetinopathy: drParsed.probability,
    hypertensionRetinopathy: null,
    glaucomaSigns: glaucomaProbability,
    glaucomaLabel,
    glaucomaConfidence,
    estimatedCdr,
    glaucomaSeverity,
    glaucomaOverlayUri,
    drSeverity: drParsed.severity,
    riskLevel,
    markerSummary,
    source: 'model',
  };
}
