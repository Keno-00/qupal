import { BiasStatsEntry, BinsEntry, SparseBasisState } from './types';

function tupleKeyFromPosBits(posBits: number[]): string {
  return posBits.join(',');
}

export function makeBinsFromSparseState(
  sparse: SparseBasisState,
  denoise = false,
  outcomeByPosKey?: Map<string, 0 | 1>,
): {
  bins: Map<string, BinsEntry>;
  biasStats?: Map<string, BiasStatsEntry>;
} {
  const bins = new Map<string, BinsEntry>();
  const biasStats = denoise ? new Map<string, BiasStatsEntry>() : undefined;

  for (let i = 0; i < sparse.entries.length; i += 1) {
    const { index, probability } = sparse.entries[i];

    const posBits: number[] = [];
    for (let b = 0; b < sparse.posLen; b += 1) {
      posBits.push((index >> b) & 1);
    }

    let intensityValue = 0;
    for (let b = 0; b < sparse.bitDepth; b += 1) {
      if ((index >> (sparse.posLen + b)) & 1) {
        intensityValue |= 1 << b;
      }
    }

    const intensityNormalized = intensityValue / (2 ** sparse.bitDepth - 1);
    const key = tupleKeyFromPosBits(posBits);
    const current = bins.get(key) ?? { intensity_sum: 0, intensity_squared_sum: 0, count: 0 };

    current.intensity_sum += intensityNormalized * probability;
    current.intensity_squared_sum += intensityNormalized * intensityNormalized * probability;
    current.count += probability;
    bins.set(key, current);

    if (biasStats) {
      const currentBias =
        biasStats.get(key) ?? { hit: 0, miss: 0, intensity_hit: 0, intensity_miss: 0 };
      const outcomeBit = outcomeByPosKey?.get(key) ?? 0;

      if (outcomeBit === 1) {
        currentBias.hit += probability;
        currentBias.intensity_hit += intensityNormalized * probability;
      } else {
        currentBias.miss += probability;
        currentBias.intensity_miss += intensityNormalized * probability;
      }

      biasStats.set(key, currentBias);
    }
  }

  return { bins, biasStats };
}
