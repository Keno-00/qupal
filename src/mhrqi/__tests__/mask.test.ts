import { applyCircularFundusMask } from '../mask';

describe('MHRQI circular fundus mask', () => {
  test('sets corner pixels to black', () => {
    const side = 8;
    const image = new Float32Array(side * side).fill(1);

    applyCircularFundusMask(image, side, 0.48);

    expect(image[0]).toBe(0);
    expect(image[side - 1]).toBe(0);
    expect(image[(side - 1) * side]).toBe(0);
    expect(image[side * side - 1]).toBe(0);
  });

  test('preserves central region', () => {
    const side = 8;
    const image = new Float32Array(side * side).fill(0.7);

    applyCircularFundusMask(image, side, 0.48);

    const center = Math.floor(side / 2);
    expect(image[center * side + center]).toBeCloseTo(0.7, 6);
  });
});
