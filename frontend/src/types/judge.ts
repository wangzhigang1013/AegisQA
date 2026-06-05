export type JudgeProfile = {
  profile_id: string;
  name: string;
  version: number;
  model: string;
  prompt: string;
  rubric: Record<string, unknown>;
  threshold: number;
  output_schema: Record<string, unknown>;
  status: string;
  created_at: string;
};

export type StoredJudgeAudit = {
  audit_id: string;
  judge_profile_id: string;
  dataset_version_id: string;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  cohen_kappa: number;
  confusion_matrix: Record<string, Record<string, number>>;
  misclassified_items: Record<string, unknown>[];
  created_at: string;
};

export type JudgeCrossValidationResult = {
  dataset_version_id: string;
  profile_count: number;
  pairwise_agreement: Record<string, number>;
  audits: Record<string, Partial<StoredJudgeAudit>>;
};

export type JudgeAuditTrends = {
  summary: {
    audit_count: number;
    profile_count: number;
    low_consistency_count: number;
  };
  profiles: {
    profile_id: string;
    audit_count: number;
    latest_accuracy: number;
    latest_kappa: number;
    series: {
      audit_id: string;
      dataset_version_id: string;
      accuracy: number;
      precision: number;
      recall: number;
      f1: number;
      cohen_kappa: number;
      misclassified_count: number;
      created_at: string;
    }[];
  }[];
  low_consistency_profiles: {
    profile_id: string;
    accuracy: number;
    cohen_kappa: number;
    message: string;
  }[];
};

