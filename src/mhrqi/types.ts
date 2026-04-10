export type BinsEntry = {
  intensity_sum: number;
  intensity_squared_sum: number;
  count: number;
};

export type BiasStatsEntry = {
  hit: number;
  miss: number;
  intensity_hit: number;
  intensity_miss: number;
};

export type SparseBasisState = {
  dimension: number;
  posLen: number;
  bitDepth: number;
  entries: Array<{ index: number; probability: number }>;
};

export type PreprocessedImage = {
  size: number;
  normalized: Float32Array;
};

export type MhrqiScores = {
  diabeticRetinopathy: number;
  hypertensionRetinopathy: number;
  glaucomaSigns: number;
  markerSummary: string;
  meta: {
    imageSide: number;
    pixelCount: number;
    sparseEntries: number;
  };
};
