export type ActionTarget =
  | {
      type: 'route';
      url: string;
    }
  | {
      type: 'api';
      url: string;
      method?: string;
    };

export type WorkbenchAction = {
  id?: string;
  action: string;
  label: string;
  enabled?: boolean;
  disabled?: boolean;
  disabled_reason?: string | null;
  priority?: string | null;
  severity?: string | null;
  target_url?: string | null;
  target?: ActionTarget | null;
  permission?: string | null;
  method?: string | null;
  evidence?: string[];
  payload?: Record<string, unknown>;
};
