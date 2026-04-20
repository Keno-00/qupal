export type InferenceTensor =
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

export type GlaucomaLabel = 'Referable Glaucoma' | 'Non-Referable Glaucoma';

export type GlaucomaSeverity = 'mild' | 'moderate' | 'severe';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function sigmoid(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function softmax(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }

  let maxValue = values[0] ?? 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > maxValue) {
      maxValue = values[i];
    }
  }

  const exps = values.map((value) => Math.exp(value - maxValue));
  const sum = exps.reduce((acc, value) => acc + value, 0);
  if (!Number.isFinite(sum) || sum <= 0) {
    return values.map(() => 0);
  }
  return exps.map((value) => value / sum);
}

function looksLikeProbabilityDistribution(values: number[]): boolean {
  if (values.length === 0) {
    return false;
  }
  const inRange = values.every((value) => value >= 0 && value <= 1);
  if (!inRange) {
    return false;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum > 0.9 && sum < 1.1;
}

function normalizeTensorValuesLikeSource(tensor: InferenceTensor, values: number[]): number[] {
  if (tensor instanceof Uint8Array) {
    return values.map((v) => v / 255);
  }
  if (tensor instanceof Int8Array) {
    return values.map((v) => (v + 128) / 255);
  }
  return values;
}

export function parseDrSeverityLikeSource(drOutputTensor: InferenceTensor): {
  severity: 0 | 1 | 2 | 3 | 4;
  probability: number;
} {
  const rawValues = Array.from(drOutputTensor, Number);
  const values = normalizeTensorValuesLikeSource(drOutputTensor, rawValues);

  if (values.length < 5) {
    throw new Error('DR model output tensor is invalid. Expected at least 5 values.');
  }

  const classScores = values.slice(0, 5);
  const probs = looksLikeProbabilityDistribution(classScores)
    ? classScores.map(clamp01)
    : softmax(classScores).map(clamp01);
  const severity = probs.reduce(
    (best, value, idx) => (value > probs[best] ? idx : best),
    0,
  ) as 0 | 1 | 2 | 3 | 4;

  return { severity, probability: probs[severity] ?? 0 };
}

export function parseGlaucomaProbabilityLikeSource(outputTensor: InferenceTensor): number {
  const rawValues = Array.from(outputTensor, Number);
  const values = normalizeTensorValuesLikeSource(outputTensor, rawValues);

  if (values.length === 0) {
    throw new Error('Glaucoma model output tensor is invalid. Expected at least 1 value after flattening outputs.');
  }

  if (values.length === 1) {
    const scalar = values[0] ?? 0;
    if (scalar > 0 && scalar < 1) {
      return clamp01(scalar);
    }
    return clamp01(sigmoid(scalar));
  }

  const binaryScores = values.slice(0, 2);
  const probs = looksLikeProbabilityDistribution(binaryScores)
    ? binaryScores.map(clamp01)
    : softmax(binaryScores).map(clamp01);

  return clamp01(probs[1] ?? 0);
}

export function classifyGlaucomaLikeSource(probability: number): GlaucomaLabel {
  return probability > 0.5 ? 'Referable Glaucoma' : 'Non-Referable Glaucoma';
}

export function glaucomaSeverityFromCdr(cdr: number): GlaucomaSeverity {
  if (cdr < 0.6) {
    return 'mild';
  }
  if (cdr < 0.8) {
    return 'moderate';
  }
  return 'severe';
}