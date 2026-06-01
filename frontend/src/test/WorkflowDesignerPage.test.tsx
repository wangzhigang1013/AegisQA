import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { demoSkills, installDefaultWorkbenchMocks, jsonResponse, renderWorkbench } from './workbenchTestHarness';

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

  it('可选输入字段留空时不会写入草稿 input_mapping', async () => {
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/skills')) {
        return jsonResponse(demoSkills.map((skill) => (
          skill.skill_id === 'llm.call@0.1.0'
            ? {
                ...skill,
                input_schema: {
                  ...skill.input_schema,
                  properties: { ...(skill.input_schema.properties ?? {}), variables: { type: 'object' } },
                },
              }
            : skill
        )));
      }
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/workflows/designer/draft-test');

    expect(await screen.findByText('输入字段 variables')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('字段路径 prompt'), { target: { value: 'row.prompt_text' } });
    fireEvent.click(screen.getByRole('button', { name: /保存草稿/ }));

    await waitFor(() => {
      const saveCall = vi
        .mocked(globalThis.fetch)
        .mock.calls.find(([input, init]) => String(input).endsWith('/workflow-drafts/draft-test') && init?.method === 'PUT');
      expect(saveCall).toBeTruthy();
      const body = JSON.parse(String(saveCall?.[1]?.body ?? '{}'));
      const answerNode = body.graph.nodes.find((node: { node_id: string }) => node.node_id === 'answer');
      expect(answerNode.input_mapping).toEqual({ prompt: 'row.prompt_text' });
      expect(answerNode.input_mapping).not.toHaveProperty('variables');
    });
  });
});
