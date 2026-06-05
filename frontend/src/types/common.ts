export type ApiError = {
  code: string;
  message: string;
  details: Record<string, unknown>;
  trace_id: string;
};

