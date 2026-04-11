import * as FileSystem from 'expo-file-system/legacy';

import { generateHierarchicalCoordMatrix } from './hierarchy';
import { makeBinsFromSparseState } from './decode';
import { preprocessImageForMhrqi } from './preprocess';
import { binsToImage } from './reconstruct';
import { MhrqiScores } from './types';
import { buildSparseBasisState } from './upload';
import { computeDenoiseOutcomes } from './denoise';
import { bytesToBase64 } from '../utils/base64';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function writeU16LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >> 8) & 0xff;
}

function writeU32LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >> 8) & 0xff;
  target[offset + 2] = (value >> 16) & 0xff;
  target[offset + 3] = (value >> 24) & 0xff;
}

function grayscaleToBmpBase64(image: Float32Array, side: number): string {
  const bytesPerPixel = 3;
  const rowStride = side * bytesPerPixel;
  const paddedRowStride = (rowStride + 3) & ~3;
  const pixelDataSize = paddedRowStride * side;
  const fileHeaderSize = 14;
  const dibHeaderSize = 40;
  const pixelOffset = fileHeaderSize + dibHeaderSize;
  const fileSize = pixelOffset + pixelDataSize;

  const bmp = new Uint8Array(fileSize);

  // BITMAPFILEHEADER
  bmp[0] = 0x42; // B
  bmp[1] = 0x4d; // M
  writeU32LE(bmp, 2, fileSize);
  writeU32LE(bmp, 6, 0);
  writeU32LE(bmp, 10, pixelOffset);

  // BITMAPINFOHEADER
  writeU32LE(bmp, 14, dibHeaderSize);
  writeU32LE(bmp, 18, side);
  writeU32LE(bmp, 22, side); // positive => bottom-up rows
  writeU16LE(bmp, 26, 1);
  writeU16LE(bmp, 28, 24);
  writeU32LE(bmp, 30, 0);
  writeU32LE(bmp, 34, pixelDataSize);
  writeU32LE(bmp, 38, 2835);
  writeU32LE(bmp, 42, 2835);
  writeU32LE(bmp, 46, 0);
  writeU32LE(bmp, 50, 0);

  let out = pixelOffset;
  for (let row = 0; row < side; row += 1) {
    const srcY = side - 1 - row;
    for (let x = 0; x < side; x += 1) {
      const value = Math.round(clamp01(image[srcY * side + x]) * 255);
      bmp[out++] = value; // B
      bmp[out++] = value; // G
      bmp[out++] = value; // R
    }
    while ((out - pixelOffset) % paddedRowStride !== 0) {
      bmp[out++] = 0;
    }
  }

  return bytesToBase64(bmp);
}

async function persistMhrqiImage(reconstructed: Float32Array, side: number): Promise<string | null> {
  if (!FileSystem.documentDirectory) {
    return null;
  }

  const dir = `${FileSystem.documentDirectory}mhrqi/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const targetUri = `${dir}mhrqi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.bmp`;
  const base64 = grayscaleToBmpBase64(reconstructed, side);
  await FileSystem.writeAsStringAsync(targetUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return targetUri;
}

function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
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

export async function analyzeWithMhrqi(
  uri: string,
  preferredTarget = 1024,
  onProgress?: (progress01: number) => void,
): Promise<MhrqiScores> {
  const report = async (progress01: number) => {
    onProgress?.(clamp01(progress01));
    await tick();
  };

  await report(0.02);
  const preprocessed = await preprocessImageForMhrqi(uri, preferredTarget);
  await report(0.2);
  const hierarchy = generateHierarchicalCoordMatrix(preprocessed.size, 2);
  await report(0.35);
  const sparse = buildSparseBasisState(hierarchy, preprocessed.normalized, preprocessed.size, 8);
  await report(0.55);
  const outcomes = computeDenoiseOutcomes(
    hierarchy,
    preprocessed.normalized,
    preprocessed.size,
    sparse.bitDepth,
  );
  await report(0.72);
  const { bins, biasStats } = makeBinsFromSparseState(sparse, true, outcomes);
  await report(0.82);
  const reconstructed = binsToImage(
    bins,
    hierarchy,
    [preprocessed.size, preprocessed.size],
    biasStats,
  );
  await report(0.92);

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

  await report(1);

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

export async function runMhrqiPreprocessPass(
  uri: string,
  preferredTarget = 1024,
  onProgress?: (progress01: number) => void,
): Promise<{ imageSide: number; pixelCount: number; sparseEntries: number; outputUri: string | null }> {
  const report = async (progress01: number) => {
    onProgress?.(clamp01(progress01));
    await tick();
  };

  await report(0.02);
  const preprocessed = await preprocessImageForMhrqi(uri, preferredTarget);
  await report(0.2);
  const hierarchy = generateHierarchicalCoordMatrix(preprocessed.size, 2);
  await report(0.35);
  const sparse = buildSparseBasisState(hierarchy, preprocessed.normalized, preprocessed.size, 8);
  await report(0.55);
  const outcomes = computeDenoiseOutcomes(
    hierarchy,
    preprocessed.normalized,
    preprocessed.size,
    sparse.bitDepth,
  );
  await report(0.72);
  const { bins, biasStats } = makeBinsFromSparseState(sparse, true, outcomes);
  await report(0.82);
  const reconstructed = binsToImage(
    bins,
    hierarchy,
    [preprocessed.size, preprocessed.size],
    biasStats,
  );
  const outputUri = await persistMhrqiImage(reconstructed, preprocessed.size);
  await report(1);

  return {
    imageSide: preprocessed.size,
    pixelCount: preprocessed.size * preprocessed.size,
    sparseEntries: sparse.entries.length,
    outputUri,
  };
}
