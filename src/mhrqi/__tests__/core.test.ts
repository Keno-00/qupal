import { generateHierarchicalCoordMatrix, composeRc } from '../hierarchy';
import { buildSparseBasisState, quantizeIntensity } from '../upload';
import { makeBinsFromSparseState } from '../decode';
import { binsToImage } from '../reconstruct';

describe('MHRQI core behavior', () => {
  test('hierarchical matrix covers all coordinates bijectively for N=4', () => {
    const n = 4;
    const matrix = generateHierarchicalCoordMatrix(n, 2);
    expect(matrix).toHaveLength(n * n);

    const seen = new Set<string>();
    for (let i = 0; i < matrix.length; i += 1) {
      const [r, c] = composeRc(matrix[i], 2);
      seen.add(`${r},${c}`);
    }

    expect(seen.size).toBe(n * n);
  });

  test('quantizeIntensity mirrors floor(u*(2^b-1))', () => {
    expect(quantizeIntensity(0, 8)).toBe(0);
    expect(quantizeIntensity(1, 8)).toBe(255);
    expect(quantizeIntensity(0.5, 8)).toBe(127);
  });

  test('sparse upload + decode conserves total probability and reconstructs baseline', () => {
    const n = 4;
    const matrix = generateHierarchicalCoordMatrix(n, 2);

    const normalized = new Float32Array(n * n);
    for (let i = 0; i < normalized.length; i += 1) {
      normalized[i] = i / (normalized.length - 1);
    }

    const sparse = buildSparseBasisState(matrix, normalized, n, 8);
    const { bins } = makeBinsFromSparseState(sparse, false);

    let total = 0;
    bins.forEach((v) => {
      total += v.count;
    });
    expect(total).toBeCloseTo(1, 8);

    const reconstructed = binsToImage(bins, matrix, [n, n]);
    const firstQ = quantizeIntensity(normalized[0], 8) / 255;
    const lastQ = quantizeIntensity(normalized[normalized.length - 1], 8) / 255;

    expect(reconstructed[0]).toBeCloseTo(firstQ, 6);
    expect(reconstructed[reconstructed.length - 1]).toBeCloseTo(lastQ, 6);
  });
});
