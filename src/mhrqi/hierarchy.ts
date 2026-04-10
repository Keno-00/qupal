function getMaxDepth(n: number, d: number): number {
  return Math.floor(Math.log(n) / Math.log(d));
}

function getSubdivSize(k: number, n: number, d: number): number {
  return n / d ** k;
}

function computeRegister(r: number, c: number, d: number, skPrev: number): [number, number] {
  const qx = Math.min(Math.floor((c % skPrev) * (d / skPrev)), d - 1);
  const qy = Math.min(Math.floor((r % skPrev) * (d / skPrev)), d - 1);
  return [qy, qx];
}

export function composeRc(hierarchicalCoordVector: readonly number[], d = 2): [number, number] {
  if (hierarchicalCoordVector.length % 2 !== 0) {
    throw new Error('hierarchical_coord_vector length must be even (pairs of qy,qx).');
  }

  let r = 0;
  let c = 0;

  for (let i = 0; i < hierarchicalCoordVector.length; i += 2) {
    const qy = hierarchicalCoordVector[i];
    const qx = hierarchicalCoordVector[i + 1];

    if (!(qy >= 0 && qy < d)) {
      throw new Error('qy digit out of range for given d.');
    }
    if (!(qx >= 0 && qx < d)) {
      throw new Error('qx digit out of range for given d.');
    }

    r = r * d + qy;
    c = c * d + qx;
  }

  return [r, c];
}

export function generateHierarchicalCoordMatrix(n: number, d = 2): number[][] {
  const maxDepth = getMaxDepth(n, d);
  const subdivSizes: number[] = [];

  for (let level = 0; level < maxDepth; level += 1) {
    subdivSizes.push(level === 0 ? n : getSubdivSize(level, n, d));
  }

  const matrix: number[][] = [];
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      const hierarchicalCoordVector: number[] = [];
      for (let i = 0; i < subdivSizes.length; i += 1) {
        const [qy, qx] = computeRegister(r, c, d, subdivSizes[i]);
        hierarchicalCoordVector.push(qy, qx);
      }
      matrix.push(hierarchicalCoordVector);
    }
  }

  return matrix;
}
