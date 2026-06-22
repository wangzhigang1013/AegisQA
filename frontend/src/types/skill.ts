export type SkillManifest = {
  skill_id: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  scenarios: string[];
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  config_schema: Record<string, unknown>;
  cacheable: boolean;
  permissions: string[];
  enabled: boolean;
  status: string;
  example_input: Record<string, unknown>;
  example_config: Record<string, unknown>;
};

export type SkillContractResult = {
  skill_id: string;
  ok: boolean;
  latency_ms?: number;
  output?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  error?: string;
  message?: string;
  code?: string;
  retry_count?: number;
};

export type SkillPackageSecurity = {
  file_count: number;
  total_size_bytes: number;
  max_file_size_bytes: number;
  limits?: {
    max_files?: number;
    max_file_size_bytes?: number;
    max_total_size_bytes?: number;
  };
};

export type SkillPackageRecord = {
  package_id: string;
  filename: string;
  status: string;
  manifest: SkillManifest;
  package_dir?: string;
  handler_path?: string | null;
  skill_md_path?: string | null;
  runtime_mode?: string;
  entrypoint?: string | null;
  package_security?: SkillPackageSecurity | null;
  last_contract_ok: boolean;
  last_contract_result?: Record<string, unknown> | null;
  last_contract_at?: string | null;
  contract_history?: SkillPackageContractHistoryItem[];
  approved_by?: string | null;
  approved_at?: string | null;
  approval_note?: string | null;
  approval_history?: SkillPackageApprovalHistoryItem[];
  base_skill_id?: string;
  skill_version?: string;
  created_at: string;
  updated_at: string;
};

export type SkillPackageContractHistoryItem = {
  ok: boolean;
  actor?: string;
  created_at: string;
  latency_ms?: number | null;
  error?: string | null;
  code?: string | null;
  message?: string | null;
};

export type SkillPackageApprovalHistoryItem = {
  action: string;
  actor?: string;
  reason?: string;
  target_skill_id?: string;
  created_at: string;
};

export type SkillVersionDiff = {
  field: string;
  from?: unknown;
  to?: unknown;
};

export type SkillVersionHistoryItem = SkillPackageRecord & {
  skill_id: string;
  version: string;
  enabled: boolean;
  diff_from_previous: SkillVersionDiff[];
};

export type SkillVersionHistory = {
  base_skill_id: string;
  requested_skill_id: string;
  latest_approved_skill_id?: string | null;
  versions: SkillVersionHistoryItem[];
};

export type AgentSkillDiscoveryItem = {
  name: string;
  description: string;
  source_dir: string;
  skill_md_path: string;
  source_root: string;
  skill_id_candidate: string;
  runtime_mode: string;
  already_imported: boolean;
};

export type AgentSkillDiscoveryResult = {
  count: number;
  items: AgentSkillDiscoveryItem[];
};

export type AgentSkillRecord = {
  agent_skill_id: string;
  source_dir: string;
  skill_md_path: string;
  runtime_mode: string;
  status: string;
  manifest: SkillManifest;
  last_contract_ok: boolean;
  last_contract_result?: Record<string, unknown> | null;
  last_contract_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  approval_note?: string | null;
  created_at: string;
  updated_at: string;
};

