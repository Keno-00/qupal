import { generateHierarchicalCoordMatrix } from './hierarchy';
import { makeBinsFromSparseState } from './decode';
import { preprocessImageForMhrqi } from './preprocess';
import { binsToImage } from './reconstruct';
import { MhrqiScores } from './types';
import { buildSparseBasisState } from './upload';
import { computeDenoiseOutcomes } from './denoise';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mean(values: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
  }
  return values.length > 0 ? sum / values.length : 0;
}

function std(values: Float32Array, avg: number): number {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const d = values[i] - avg;
    sum += d * d;
  }
  return values.length > 0 ? Math.sqrt(sum / values.length) : 0;
}

function centralCupProxy(image: Float32Array, side: number): number {
  const center = side / 2;
  const inner = side * 0.12;
  const outer = side * 0.24;

  let innerSum = 0;
  let innerCount = 0;
  let outerSum = 0;
  let outerCount = 0;

  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const dx = x - center;
      const dy = y - center;
      const d = Math.sqrt(dx * dx + dy * dy);
      const v = image[y * side + x];
      if (d <= inner) {
        innerSum += v;
        innerCount += 1;
      } else if (d <= outer) {
        outerSum += v;
        outerCount += 1;
      }
    }
  }

  const innerMean = innerCount > 0 ? innerSum / innerCount : 0;
  const outerMean = outerCount > 0 ? outerSum / outerCount : 0;
  return clamp01(0.5 + (innerMean - outerMean));
}

function vesselContrastProxy(image: Float32Array, side: number): number {
  let acc = 0;
  let count = 0;
  for (let y = 1; y < side - 1; y += 1) {
    for (let x = 1; x < side - 1; x += 1) {
      const center = image[y * side + x];
      const gx = Math.abs(image[y * side + (x + 1)] - image[y * side + (x - 1)]);
      const gy = Math.abs(image[(y + 1) * side + x] - image[(y - 1) * side + x]);
      acc += (gx + gy) * (0.5 + center);
      count += 1;
    }
  }
  return clamp01(count > 0 ? acc / count : 0);
}

function lesionTextureProxy(image: Float32Array, side: number): number {
  let acc = 0;
  let count = 0;
  for (let y = 0; y < side - 1; y += 1) {
    for (let x = 0; x < side - 1; x += 1) {
      const a = image[y * side + x];
      const b = image[y * side + (x + 1)];
      const c = image[(y + 1) * side + x];
      acc += Math.abs(a - b) + Math.abs(a - c);
      count += 2;
    }
  }
  return clamp01(count > 0 ? acc / count : 0);
}

export async function analyzeWithMhrqi(uri: string, preferredTarget = 1024): Promise<MhrqiScores> {
  const preprocessed = await preprocessImageForMhrqi(uri, preferredTarget);
  const hierarchy = generateHierarchicalCoordMatrix(preprocessed.size, 2);
  const sparse = buildSparseBasisState(hierarchy, preprocessed.normalized, preprocessed.size, 8);
  const outcomes = computeDenoiseOutcomes(
    hierarchy,
    preprocessed.normalized,
    preprocessed.size,
    sparse.bitDepth,
  );
  const { bins, biasStats } = makeBinsFromSparseState(sparse, true, outcomes);
  const reconstructed = binsToImage(
    bins,
    hierarchy,
    [preprocessed.size, preprocessed.size],
    biasStats,
  );

  const avg = mean(reconstructed);
  const sigma = std(reconstructed, avg);

  const dr = clamp01(0.42 * lesionTextureProxy(reconstructed, preprocessed.size) + 0.58 * sigma);
  const htn = clamp01(0.55 * vesselContrastProxy(reconstructed, preprocessed.size) + 0.45 * (1 - avg));
  const glaucoma = clamp01(0.7 * centralCupProxy(reconstructed, preprocessed.size) + 0.3 * sigma);

  const markers: string[] = [];
  if (dr >= 0.5) {
    markers.push('microaneurysm-like pattern');
  }
  if (htn >= 0.5) {
    markers.push('arteriolar narrowing pattern');
  }
  if (glaucoma >= 0.5) {
    markers.push('cup-disc asymmetry pattern');
  }

  return {
    diabeticRetinopathy: dr,
    hypertensionRetinopathy: htn,
    glaucomaSigns: glaucoma,
    markerSummary:
      markers.length > 0 ? markers.join(', ') : 'No dominant marker pattern detected in MHRQI pipeline.',
    meta: {
      imageSide: preprocessed.size,
      pixelCount: preprocessed.size * preprocessed.size,
      sparseEntries: sparse.entries.length,
    },
  };
}
