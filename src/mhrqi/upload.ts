import { composeRc } from './hierarchy';
import { SparseBasisState } from './types';

export function quantizeIntensity(value01: number, bitDepth: number): number {
  const clamped = Math.max(0, Math.min(1, value01));
  return Math.floor(clamped * (2 ** bitDepth - 1));
}

export function buildSparseBasisState(
  hierarchicalCoordMatrix: readonly number[][],
  normalizedImage: Float32Array,
  imageSide: number,
  bitDepth = 8,
): SparseBasisState {
  const posLen = hierarchicalCoordMatrix[0]?.length ?? 0;
  const totalQubits = posLen + bitDepth;
  const dimension = 2 ** totalQubits;

  const entries: Array<{ index: number; probability: number }> = [];
  const probability = hierarchicalCoordMatrix.length > 0 ? 1 / hierarchicalCoordMatrix.length : 0;

  for (let idx = 0; idx < hierarchicalCoordMatrix.length; idx += 1) {
    const vec = hierarchicalCoordMatrix[idx];

    let p = 0;
    for (let i = 0; i < vec.length; i += 1) {
      if (vec[i]) {
        p |= 1 << i;
      }
    }

    const [r, c] = composeRc(vec, 2);
    const pixel = normalizedImage[r * imageSide + c] ?? 0;
    const intensityInt = quantizeIntensity(pixel, bitDepth);

    const index = p + (intensityInt << posLen);
    entries.push({ index, probability });
  }

  return { dimension, posLen, bitDepth, entries };
}
