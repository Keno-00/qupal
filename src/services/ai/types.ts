export type AiRiskLevel = 'low' | 'medium' | 'high';

export type DrSeverity = 0 | 1 | 2 | 3 | 4;

export type InferenceAvailability = 'ready' | 'unavailable';

export type FundusModelOutput = {
  diabeticRetinopathy: number;
  hypertensionRetinopathy: null;
  glaucomaSigns: number;
  drSeverity: DrSeverity;
  riskLevel: AiRiskLevel;
  markerSummary: string;
  source: 'model';
};

export type InferenceBootstrapStatus = {
  availability: InferenceAvailability;
  reason?: string;
};
