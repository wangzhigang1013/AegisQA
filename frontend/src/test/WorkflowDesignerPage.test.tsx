import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { demoDataset, demoSkills, demoWorkflowGraph, installDefaultWorkbenchMocks, jsonResponse, renderWorkbench, findComboboxByLabel } from './workbenchTestHarness';

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

  it('校验错误在顶部和当前节点 Inspector 就近展示，避免来回滚动', async () => {
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/workflow-graphs/validate')) {
        return jsonResponse({
          ok: false,
          errors: [
            {
              code: 'UPSTREAM_OUTPUT_NOT_CONNECTED',
              message: '输入绑定引用了非上游节点输出：answer.answer',
              node_id: 'judge_a',
              details: { missing_path: 'answer.answer', referenced_node_id: 'answer', current_node_id: 'judge_a' },
            },
          ],
          warnings: [],
          execution_levels: [],
          graph_tips: [],
          node_count: 3,
          edge_count: 1,
        });
      }
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.click(await screen.findByRole('button', { name: /校验当前画布/ }));

    expect(await screen.findByText('当前校验问题')).toBeInTheDocument();
    expect(screen.getAllByText(/输入绑定引用了非上游节点输出/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /定位节点 judge_a/ }));
    expect(await screen.findByText('当前节点问题')).toBeInTheDocument();
    expect(screen.getAllByText(/从 answer 连接到 judge_a/).length).toBeGreaterThan(0);
  });

  it('数据集字段很多时，字段预览使用搜索和分页，路径候选不再一次性铺满视野', async () => {
    const fieldNames = Array.from({ length: 60 }, (_, index) => `field_${index}`);
    const wideVersion = {
      ...demoDataset.versions[0],
      name: '宽字段集',
      version_id: 'wide:v1',
      field_schema: Object.fromEntries(fieldNames.map((field) => [field, 'string'])),
      field_paths: fieldNames.map((field) => `row.${field}`),
      preview: [Object.fromEntries(fieldNames.map((field, index) => [field, `value_${index}`]))],
    };
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/datasets')) return jsonResponse([{ ...demoDataset, name: '宽字段集', versions: [wideVersion] }]);
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.mouseDown(findComboboxByLabel('映射预览数据集 / 试运行数据集'));
    fireEvent.click(await screen.findByText('宽字段集 v1'));

    expect(await screen.findByText(/共 60 个字段，已开启搜索和分页/)).toBeInTheDocument();
    expect(screen.queryByText('row.field_59')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('搜索字段路径、类型或示例值'), { target: { value: 'field_59' } });
    expect(await screen.findByText('row.field_59')).toBeInTheDocument();
  });

  it('发布前自动校验并保存当前名称和字段映射，再发布草稿', async () => {
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/workflow-graphs/validate')) {
        return jsonResponse({ ok: true, errors: [], warnings: [], execution_levels: [['answer']], graph_tips: [], node_count: 3, edge_count: 2 });
      }
      if (url.endsWith('/workflow-drafts/draft-test/publish')) {
        return jsonResponse({ workflow_id: 'wf-custom', version_id: 'wf-custom:v1', version: 1, name: 'AP ASR 评测流程', status: 'published', graph: demoWorkflowGraph, steps: [] });
      }
      return defaultFetch?.(input, init) ?? jsonResponse({});
    });

    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.change(await screen.findByLabelText('流程名称'), { target: { value: 'AP ASR 评测流程' } });
    fireEvent.change(screen.getByLabelText('字段路径 prompt'), { target: { value: 'row.ap_code' } });
    fireEvent.click(screen.getByRole('button', { name: /校验并发布/ }));

    await waitFor(() => {
      const saveCall = vi
        .mocked(globalThis.fetch)
        .mock.calls.find(([input, init]) => String(input).endsWith('/workflow-drafts/draft-test') && init?.method === 'PUT');
      expect(saveCall).toBeTruthy();
      const body = JSON.parse(String(saveCall?.[1]?.body ?? '{}'));
      expect(body.name).toBe('AP ASR 评测流程');
      expect(body.graph.name).toBe('AP ASR 评测流程');
      const answerNode = body.graph.nodes.find((node: { node_id: string }) => node.node_id === 'answer');
      expect(answerNode.input_mapping.prompt).toBe('row.ap_code');
    });

    expect((await screen.findAllByText('发布成功：wf-custom:v1')).length).toBeGreaterThan(0);
  });
});
