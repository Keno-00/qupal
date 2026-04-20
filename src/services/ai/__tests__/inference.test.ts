import {
  classifyGlaucomaLikeSource,
  glaucomaSeverityFromCdr,
  parseDrSeverityLikeSource,
  parseGlaucomaProbabilityLikeSource,
} from '../outputParsing';

describe('inference tensor parsing', () => {
  test('DR parsing applies softmax to logits instead of direct clamping', () => {
    const parsed = parseDrSeverityLikeSource(
      new Float32Array([12, 1, -2, -3, -4]),
    );

    expect(parsed.severity).toBe(0);
    expect(parsed.probability).toBeGreaterThan(0);
    expect(parsed.probability).toBeLessThan(1);
  });

  test('DR parsing respects already-normalized probability vectors', () => {
    const parsed = parseDrSeverityLikeSource(
      new Float32Array([0.05, 0.1, 0.7, 0.1, 0.05]),
    );

    expect(parsed.severity).toBe(2);
    expect(parsed.probability).toBeCloseTo(0.7, 5);
  });

  test('Glaucoma parsing treats scalar logits with sigmoid', () => {
    const probability = parseGlaucomaProbabilityLikeSource(new Float32Array([0]));
    expect(probability).toBeCloseTo(0.5, 5);
  });

  test('Glaucoma parsing uses positive class from two-class vectors', () => {
    const probability = parseGlaucomaProbabilityLikeSource(
      new Float32Array([0.95, 0.05]),
    );

    expect(probability).toBeCloseTo(0.05, 5);
  });

  test('Glaucoma label follows app threshold semantics', () => {
    expect(classifyGlaucomaLikeSource(0.5)).toBe('Non-Referable Glaucoma');
    expect(classifyGlaucomaLikeSource(0.5001)).toBe('Referable Glaucoma');
  });

  test('Glaucoma severity is derived from CDR bands', () => {
    expect(glaucomaSeverityFromCdr(0.59)).toBe('mild');
    expect(glaucomaSeverityFromCdr(0.6)).toBe('moderate');
    expect(glaucomaSeverityFromCdr(0.8)).toBe('severe');
  });
});
