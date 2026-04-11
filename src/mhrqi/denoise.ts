import { composeRc } from './hierarchy';

function quantizeIntensity(value01: number, bitDepth: number): number {
  const clamped = Math.max(0, Math.min(1, value01));
  return Math.floor(clamped * (2 ** bitDepth - 1));
}

function vecKey(vec: readonly number[]): string {
  return vec.join(',');
}

function prefixKey(vec: readonly number[]): string {
  if (vec.length < 2) {
    return '';
  }
  return vec.slice(0, vec.length - 2).join(',');
}

function computeTopWindowMsbProxy(
  sumQuantized: number,
  count: number,
  bitDepth: number,
  topWindowBits = 4,
): 0 | 1 {
  if (count <= 0 || bitDepth <= 0) {
    return 0;
  }

  const windowBits = Math.max(1, Math.min(topWindowBits, bitDepth));
  const shift = bitDepth - windowBits;
  const parentAvg = Math.round(sumQuantized / count);
  const parentWindow = parentAvg >> shift;
  const parentProxyMsb = (parentWindow >> (windowBits - 1)) & 1;
  return parentProxyMsb === 1 ? 1 : 0;
}

export function computeDenoiseOutcomes(
  hierarchicalCoordMatrix: readonly number[][],
  normalizedImage: Float32Array,
  imageSide: number,
  bitDepth = 8,
): Map<string, 0 | 1> {
  const outcomes = new Map<string, 0 | 1>();
  if (hierarchicalCoordMatrix.length === 0) {
    return outcomes;
  }

  const numLevels = hierarchicalCoordMatrix[0].length / 2;
  const finestLevel = numLevels - 1;

  if (finestLevel <= 0) {
    for (let i = 0; i < hierarchicalCoordMatrix.length; i += 1) {
      outcomes.set(vecKey(hierarchicalCoordMatrix[i]), 1);
    }
    return outcomes;
  }

  const byPrefix = new Map<string, number[]>();
  for (let i = 0; i < hierarchicalCoordMatrix.length; i += 1) {
    const vec = hierarchicalCoordMatrix[i];
    const pKey = prefixKey(vec);
    const arr = byPrefix.get(pKey) ?? [];
    arr.push(i);
    byPrefix.set(pKey, arr);
  }

  const maxVal = 2 ** bitDepth - 1;

  byPrefix.forEach((indices) => {
    let parentSum = 0;
    for (let i = 0; i < indices.length; i += 1) {
      const vec = hierarchicalCoordMatrix[indices[i]];
      const [r, c] = composeRc(vec, 2);
      const q = quantizeIntensity(normalizedImage[r * imageSide + c] ?? 0, bitDepth);
      parentSum += q;
    }
    const parentMsb = computeTopWindowMsbProxy(parentSum, indices.length, bitDepth, 4);

    for (let i = 0; i < indices.length; i += 1) {
      const vec = hierarchicalCoordMatrix[indices[i]];
      const [r, c] = composeRc(vec, 2);
      const q = quantizeIntensity(normalizedImage[r * imageSide + c] ?? 0, bitDepth);
      const intensityMsb = (q >> (bitDepth - 1)) & 1;
      const outcome: 0 | 1 = intensityMsb === parentMsb ? 1 : 0;
      outcomes.set(vecKey(vec), outcome);
    }
  });

  return outcomes;
}
