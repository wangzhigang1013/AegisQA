export type ModelGatewayStatus = {
  provider: string;
  ready: boolean;
  mode: string;
  default_model: string;
  base_url_configured: boolean;
  api_key_configured: boolean;
  timeout_seconds: number;
  skill_ref: string;
  message: string;
};

export type ModelGatewayConfig = {
  provider: string;
  base_url?: string | null;
  secret_ref?: string | null;
  default_model: string;
  timeout_seconds: number;
  api_key_configured: boolean;
  api_key_masked?: string | null;
  source: string;
};

export type ModelGatewayConnection = {
  connection_id: string;
  name?: string | null;
  provider: string;
  base_url?: string | null;
  secret_ref?: string | null;
  default_model: string;
  timeout_seconds: number;
  enabled: boolean;
  api_key_configured: boolean;
  api_key_masked?: string | null;
};

export type ModelGatewayTestResult = {
  ok: boolean;
  response: {
    text: string;
    provider: string;
    model: string;
    usage: Record<string, unknown>;
    latency_ms: number;
    raw: Record<string, unknown>;
  };
};

export type RuntimeStatus = {
  storage: {
    backend: string;
    adapter: string;
    status: string;
    scope: string;
    message: string;
    doc_url?: string;
    config_url?: string | null;
  };
  executor: {
    backend: string;
    status: string;
    message: string;
    doc_url?: string;
    config_url?: string | null;
  };
  model_gateway: ModelGatewayStatus & {
    status: string;
    message: string;
    doc_url?: string;
    config_url?: string | null;
  };
  skill_sandbox: {
    mode: string;
    status: string;
    permissions_required: boolean;
    network_default: string;
    file_scope: string;
    limits: {
      max_files: number;
      max_file_size_bytes: number;
      max_total_size_bytes: number;
    };
    message: string;
    doc_url?: string;
    config_url?: string | null;
  };
  external_services: Record<'mysql' | 'redis' | 'celery', { status: string; message: string; doc_url?: string; config_url?: string | null }>;
  components?: RuntimeStatusComponent[];
};

export type RuntimeStatusComponent = {
  component_id: string;
  name: string;
  backend: string;
  status: string;
  status_label: string;
  message: string;
  doc_url: string;
  config_url?: string | null;
  risk_level: 'low' | 'medium' | 'high' | 'info' | string;
};

export type AuditEvent = {
  event_id: string;
  actor: string;
  action: string;
  target: string;
  detail: Record<string, unknown>;
  created_at: string;
};

