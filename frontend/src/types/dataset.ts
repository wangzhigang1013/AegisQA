export type DatasetVersion = {
  dataset_id: string;
  name: string;
  version: number;
  version_id: string;
  row_count: number;
  field_schema: Record<string, string>;
  preview: Record<string, unknown>[];
  golden: boolean;
  label_field?: string | null;
  answer_field?: string | null;
  field_paths?: string[];
};

export type DatasetSummary = {
  dataset_id: string;
  name: string;
  latest_version: number;
  latest_version_id: string;
  row_count: number;
  golden: boolean;
  versions: DatasetVersion[];
};

export type DatasetLineage = {
  dataset_id: string;
  dataset_version: number;
  dataset_version_id: string;
  name: string;
  row_count: number;
  golden: boolean;
  label_field?: string | null;
  answer_field?: string | null;
  created_at?: string;
  source: {
    type: string;
    ref: Record<string, unknown>;
  };
  field_count: number;
  fields: Record<string, string>;
  field_paths: string[];
  preview: Record<string, unknown>[];
  downstream_tasks: {
    task_id: string;
    name: string;
    status: string;
    workflow_id?: string;
    workflow_name?: string;
    workflow_version_id?: string;
    run_id?: string;
    created_at?: string;
    updated_at?: string;
  }[];
};

export type DatasetQualityField = {
  field: string;
  path: string;
  type: string;
  present_count: number;
  missing_count: number;
  coverage_rate: number;
  missing_rate: number;
  distinct_count: number;
  recommendation: {
    action: string;
    message: string;
    default_value?: unknown;
  };
};

export type DatasetDuplicateGroup = {
  row_hash: string;
  row_ids: string[];
  row_indexes?: number[];
  count: number;
  sample: Record<string, unknown>;
};

export type DatasetQualityDiagnosis = {
  dataset_id: string;
  dataset_version: number;
  dataset_version_id: string;
  name: string;
  summary: {
    row_count: number;
    field_count: number;
    fields_with_missing: number;
    duplicate_row_count: number;
    duplicate_group_count: number;
    duplicate_rate: number;
  };
  fields: DatasetQualityField[];
  duplicate_groups: DatasetDuplicateGroup[];
};

