import * as FileSystem from 'expo-file-system/legacy';
import * as jpeg from 'jpeg-js';
import { Buffer } from 'buffer';

import { PreprocessedImage } from './types';

const DEFAULT_TARGET = 1024;

function largestPowerOfTwoAtMost(value: number): number {
  if (value < 1) {
    return 1;
  }
  return 2 ** Math.floor(Math.log2(value));
}

function clampTarget(target: number, max: number): number {
  const bounded = Math.max(1, Math.min(target, max));
  return largestPowerOfTwoAtMost(bounded);
}

function toGrayscale(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export async function preprocessImageForMhrqi(
  uri: string,
  preferredTarget = DEFAULT_TARGET,
): Promise<PreprocessedImage> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const decoded = jpeg.decode(Buffer.from(base64, 'base64'), { useTArray: true });
  const { width, height, data } = decoded;

  const side = Math.min(width, height);
  const cropX = Math.floor((width - side) / 2);
  const cropY = Math.floor((height - side) / 2);

  const target = clampTarget(preferredTarget, side);
  const normalized = new Float32Array(target * target);

  for (let y = 0; y < target; y += 1) {
    for (let x = 0; x < target; x += 1) {
      const srcX = cropX + Math.floor((x / target) * side);
      const srcY = cropY + Math.floor((y / target) * side);
      const idx = (srcY * width + srcX) * 4;
      const gray = toGrayscale(data[idx], data[idx + 1], data[idx + 2]);
      normalized[y * target + x] = gray;
    }
  }

  return { size: target, normalized };
}
