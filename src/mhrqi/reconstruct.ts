import { composeRc } from './hierarchy';
import { BiasStatsEntry, BinsEntry } from './types';

function keyFromVector(vec: readonly number[]): string {
  return vec.join(',');
}

export function binsToImage(
  bins: Map<string, BinsEntry>,
  hierarchicalCoordMatrix: readonly number[][],
  imageShape: [number, number],
  biasStats?: Map<string, BiasStatsEntry>,
): Float32Array {
  const [height, width] = imageShape;
  const baseline = new Float32Array(height * width);

  for (let i = 0; i < hierarchicalCoordMatrix.length; i += 1) {
    const vec = hierarchicalCoordMatrix[i];
    const key = keyFromVector(vec);
    const bin = bins.get(key);
    if (!bin || bin.count <= 0) {
      continue;
    }
    const [r, c] = composeRc(vec, 2);
    baseline[r * width + c] = bin.intensity_sum / bin.count;
  }

  if (!biasStats) {
    return baseline;
  }

  const confidenceThreshold = 0.7;
  const confidenceMap = new Float32Array(height * width);
  confidenceMap.fill(0.5);

  for (let i = 0; i < hierarchicalCoordMatrix.length; i += 1) {
    const vec = hierarchicalCoordMatrix[i];
    const key = keyFromVector(vec);
    const [r, c] = composeRc(vec, 2);
    const stats = biasStats.get(key);
    if (!stats) {
      continue;
    }
    const total = stats.hit + stats.miss;
    confidenceMap[r * width + c] = total > 0 ? stats.hit / total : 0.5;
  }

  const output = new Float32Array(height * width);

  for (let i = 0; i < hierarchicalCoordMatrix.length; i += 1) {
    const vec = hierarchicalCoordMatrix[i];
    const [r, c] = composeRc(vec, 2);
    const centerIdx = r * width + c;
    const confidence = confidenceMap[centerIdx];

    const trusted: number[] = [];
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) {
          continue;
        }
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= height || nc < 0 || nc >= width) {
          continue;
        }
        const nIdx = nr * width + nc;
        if (confidenceMap[nIdx] <= confidenceThreshold) {
          trusted.push(baseline[nIdx]);
        }
      }
    }

    if (trusted.length === 0) {
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dr === 0 && dc === 0) {
            continue;
          }
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= height || nc < 0 || nc >= width) {
            continue;
          }
          trusted.push(baseline[nr * width + nc]);
        }
      }
    }

    const context = trusted.length > 0 ? median(trusted) : baseline[centerIdx];
    output[centerIdx] = confidence * baseline[centerIdx] + (1 - confidence) * context;
  }

  return output;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}
