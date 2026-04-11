import { CAPTURE_GUIDE_RADIUS_RATIO } from './guide';

const DEFAULT_MASK_RADIUS_RATIO = CAPTURE_GUIDE_RADIUS_RATIO;

export function applyCircularFundusMask(
  image: Float32Array,
  side: number,
  radiusRatio = DEFAULT_MASK_RADIUS_RATIO,
): void {
  if (side <= 0 || image.length !== side * side) {
    return;
  }

  const center = side / 2;
  const radius = side * Math.max(0, Math.min(0.5, radiusRatio));
  const radiusSq = radius * radius;

  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      if (dx * dx + dy * dy > radiusSq) {
        image[y * side + x] = 0;
      }
    }
  }
}
