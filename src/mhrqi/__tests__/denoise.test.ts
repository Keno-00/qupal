import { computeDenoiseOutcomes } from '../denoise';
import { generateHierarchicalCoordMatrix } from '../hierarchy';
import { buildSparseBasisState } from '../upload';
import { makeBinsFromSparseState } from '../decode';

describe('MHRQI denoising behavior', () => {
  test('finest_level == 0 yields all positive outcomes (N=2)', () => {
    const n = 2;
    const matrix = generateHierarchicalCoordMatrix(n, 2);
    const normalized = new Float32Array([0.1, 0.2, 0.3, 0.4]);

    const outcomes = computeDenoiseOutcomes(matrix, normalized, n, 8);

    expect(outcomes.size).toBe(4);
    outcomes.forEach((value) => {
      expect(value).toBe(1);
    });
  });

  test('outcomes propagate to bias stats hit/miss accounting', () => {
    const n = 4;
    const matrix = generateHierarchicalCoordMatrix(n, 2);

    // Construct two sibling groups with distinct MSB consistency patterns.
    const normalized = new Float32Array([
      0.9, 0.9, 0.9, 0.1,
      0.9, 0.9, 0.9, 0.1,
      0.1, 0.1, 0.1, 0.9,
      0.1, 0.1, 0.1, 0.9,
    ]);

    const sparse = buildSparseBasisState(matrix, normalized, n, 8);
    const outcomes = computeDenoiseOutcomes(matrix, normalized, n, 8);
    const { bins, biasStats } = makeBinsFromSparseState(sparse, true, outcomes);

    expect(biasStats).toBeDefined();
    expect(bins.size).toBe(matrix.length);

    let hits = 0;
    let misses = 0;

    biasStats?.forEach((entry) => {
      hits += entry.hit;
      misses += entry.miss;
      expect(entry.hit + entry.miss).toBeCloseTo(1 / matrix.length, 8);
    });

    expect(hits).toBeGreaterThan(0);
    expect(misses).toBeGreaterThan(0);
    expect(hits + misses).toBeCloseTo(1, 8);
  });
});
