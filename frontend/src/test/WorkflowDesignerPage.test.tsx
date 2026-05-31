import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { installDefaultWorkbenchMocks, renderWorkbench } from './workbenchTestHarness';

describe('Workflow 设计器深度交互', () => {
  installDefaultWorkbenchMocks();

  it('Skill 参数表单按 config_schema 渲染并写入草稿保存 payload', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    expect(await screen.findByText('Skill 参数')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Skill 参数 model'), { target: { value: 'gpt-4.1-mini' } });
    fireEvent.change(screen.getByLabelText('Skill 参数 temperature'), { target: { value: '0.2' } });

    fireEvent.click(screen.getByRole('button', { name: /保存草稿/ }));

    await waitFor(() => {
      const saveCall = vi
        .mocked(globalThis.fetch)
        .mock.calls.find(([input, init]) => String(input).endsWith('/workflow-drafts/draft-test') && init?.method === 'PUT');
      expect(saveCall).toBeTruthy();
      const body = JSON.parse(String(saveCall?.[1]?.body ?? '{}'));
      const answerNode = body.graph.nodes.find((node: { node_id: string }) => node.node_id === 'answer');
      expect(answerNode.config).toMatchObject({ model: 'gpt-4.1-mini', temperature: 0.2 });
    });
  });
});
