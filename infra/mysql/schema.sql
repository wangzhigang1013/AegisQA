CREATE TABLE IF NOT EXISTS skill_registry (
  skill_id VARCHAR(191) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  version VARCHAR(64) NOT NULL,
  manifest_json JSON NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(32) NOT NULL DEFAULT 'approved',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dataset_versions (
  version_id VARCHAR(191) PRIMARY KEY,
  dataset_id VARCHAR(191) NOT NULL,
  name VARCHAR(255) NOT NULL,
  version INT NOT NULL,
  row_count INT NOT NULL,
  field_schema JSON NOT NULL,
  golden BOOLEAN NOT NULL DEFAULT FALSE,
  label_field VARCHAR(191),
  answer_field VARCHAR(191),
  row_store_uri TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_dataset_version (dataset_id, version)
);

CREATE TABLE IF NOT EXISTS dataset_rows (
  dataset_version_id VARCHAR(191) NOT NULL,
  row_id VARCHAR(64) NOT NULL,
  row_index INT NOT NULL,
  row_hash CHAR(64) NOT NULL,
  row_json JSON NOT NULL,
  PRIMARY KEY (dataset_version_id, row_id),
  KEY idx_dataset_rows_index (dataset_version_id, row_index)
);

CREATE TABLE IF NOT EXISTS workflow_versions (
  version_id VARCHAR(191) PRIMARY KEY,
  workflow_id VARCHAR(191) NOT NULL,
  name VARCHAR(255) NOT NULL,
  version INT NOT NULL,
  status VARCHAR(32) NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  workflow_json JSON NOT NULL,
  published_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id VARCHAR(191) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  dataset_version_id VARCHAR(191) NOT NULL,
  workflow_version_id VARCHAR(191) NOT NULL,
  run_id VARCHAR(191),
  task_json JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tasks_status (status),
  KEY idx_tasks_dataset_workflow (dataset_version_id, workflow_version_id),
  KEY idx_tasks_run (run_id)
);

CREATE TABLE IF NOT EXISTS runs (
  run_id VARCHAR(191) PRIMARY KEY,
  workflow_version_id VARCHAR(191) NOT NULL,
  dataset_version_id VARCHAR(191) NOT NULL,
  status VARCHAR(32) NOT NULL,
  snapshot_json JSON NOT NULL,
  run_json JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS run_items (
  item_id VARCHAR(191) PRIMARY KEY,
  run_id VARCHAR(191) NOT NULL,
  row_id VARCHAR(64) NOT NULL,
  repeat_index INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  metrics_json JSON,
  context_summary_json JSON,
  error_json JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  KEY idx_run_items_run_status (run_id, status)
);

CREATE TABLE IF NOT EXISTS run_item_steps (
  step_record_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  item_id VARCHAR(191) NOT NULL,
  step_id VARCHAR(191) NOT NULL,
  skill_ref VARCHAR(191) NOT NULL,
  status VARCHAR(32) NOT NULL,
  input_hash CHAR(64),
  output_hash CHAR(64),
  input_snapshot_json JSON,
  output_snapshot_json JSON,
  metrics_json JSON,
  error_json JSON,
  latency_ms DOUBLE,
  cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
  cache_key VARCHAR(191),
  rate_limit_wait_ms DOUBLE NOT NULL DEFAULT 0,
  rate_limited_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_steps_item (item_id),
  KEY idx_steps_cache (cache_key)
);

CREATE TABLE IF NOT EXISTS badcases (
  badcase_id VARCHAR(191) PRIMARY KEY,
  run_id VARCHAR(191) NOT NULL,
  item_id VARCHAR(191) NOT NULL,
  status VARCHAR(32) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  payload_json JSON NOT NULL,
  human_label VARCHAR(64),
  problem_type VARCHAR(128),
  note TEXT,
  golden_candidate BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS judge_profiles (
  profile_id VARCHAR(191) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  version INT NOT NULL,
  model VARCHAR(191) NOT NULL,
  prompt TEXT NOT NULL,
  rubric_json JSON NOT NULL,
  threshold DOUBLE NOT NULL,
  output_schema_json JSON NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS judge_audits (
  audit_id VARCHAR(191) PRIMARY KEY,
  judge_profile_id VARCHAR(191) NOT NULL,
  dataset_version_id VARCHAR(191) NOT NULL,
  metrics_json JSON NOT NULL,
  confusion_matrix_json JSON NOT NULL,
  misclassified_items_json JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prompt_candidates (
  candidate_id VARCHAR(191) PRIMARY KEY,
  source_badcase_id VARCHAR(191) NOT NULL,
  judge_profile_id VARCHAR(191) NOT NULL,
  prompt_version VARCHAR(191) NOT NULL,
  sample_json JSON NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  reviewer VARCHAR(191),
  decision VARCHAR(64),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_events (
  event_id VARCHAR(191) PRIMARY KEY,
  actor VARCHAR(191) NOT NULL,
  role VARCHAR(191) NOT NULL DEFAULT 'System',
  action VARCHAR(191) NOT NULL,
  target VARCHAR(191) NOT NULL,
  result VARCHAR(32) NOT NULL DEFAULT 'success',
  trace_id VARCHAR(191) NOT NULL DEFAULT '',
  detail_json JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS json_documents (
  document_key VARCHAR(512) PRIMARY KEY,
  collection VARCHAR(191) NOT NULL,
  payload_json JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  KEY idx_json_documents_collection (collection),
  KEY idx_json_documents_updated_at (updated_at)
);

CREATE TABLE IF NOT EXISTS jsonl_rows (
  stream_key VARCHAR(512) NOT NULL,
  row_index INT NOT NULL,
  payload_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (stream_key, row_index)
);
