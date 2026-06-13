import type { WorkbenchAction } from '../types';

export type WorkbenchActionRunner = {
  navigate: (url: string) => void;
  createRepairTasks?: () => void;
  fallback?: (actionId: string) => void;
  notify?: (message: string) => void;
};

export function workbenchActionId(action: Pick<WorkbenchAction, 'id' | 'action'>): string {
  return action.id ?? action.action;
}

export function workbenchActionTargetUrl(action: WorkbenchAction): string | null {
  if (action.target?.type === 'route') {
    return action.target.url;
  }
  return action.target_url ?? null;
}

export function runWorkbenchAction(action: WorkbenchAction, runner: WorkbenchActionRunner) {
  const actionId = workbenchActionId(action);
  if (action.enabled === false || action.disabled) {
    runner.notify?.(action.disabled_reason ?? '当前动作不可执行。');
    return;
  }
  if (actionId === 'create_repair_tasks') {
    runner.createRepairTasks?.();
    return;
  }
  const targetUrl = workbenchActionTargetUrl(action);
  if (targetUrl) {
    runner.navigate(targetUrl);
    return;
  }
  runner.fallback?.(actionId);
}
