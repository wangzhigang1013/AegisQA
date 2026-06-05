import { expect, test } from '@playwright/test';

test('Workflow 设计器直接入口默认打开空白画布', async ({ page }) => {
  await page.goto('/workflows/designer');

  await expect(page.getByText('Skill Palette')).toBeVisible();
  await expect(page.locator('input[value="未命名 Workflow"]')).toBeVisible();
  await expect(page.locator('input[value="RAG 回归评测：生成、多裁判、汇总报告"]')).toHaveCount(0);
  await expect(page.getByLabel('字段路径 prompt')).toHaveCount(0);
});

test('Workflow 画布可以从 Palette 新增 Source、Skill、Join、Output', async ({ page }) => {
  await createWorkflowDraft(page, `E2E Palette ${Date.now()}`);

  await page.getByRole('button', { name: /新增 Source/ }).click();
  await expect(page.locator('input[value="Source"]').first()).toBeVisible();

  await page.getByRole('button', { name: /Deterministic LLM Call/ }).click();
  await expect(page.locator('input[value="Deterministic LLM Call"]').first()).toBeVisible();

  await page.getByRole('button', { name: /新增 Join/ }).click();
  await expect(page.locator('input[value="Join"]').first()).toBeVisible();

  await page.getByRole('button', { name: /新增 Aggregator/ }).click();
  await page.getByText('均值').click();
  await expect(page.getByText(/聚合策略已更新：mean/)).toBeVisible();

  await page.getByRole('button', { name: /新增 Output/ }).click();
  await expect(page.locator('input[value="Output"]').first()).toBeVisible();
});

test('Workflow 画布可以新增、删除、校验并发布流程', async ({ page }) => {
  await createRagWorkflowDraft(page, `E2E 发布 ${Date.now()}`);

  await page.getByRole('button', { name: /删除连线 answer -> judge_a/ }).click();
  await expect(page.getByText(/已删除连线：answer-judge_a/)).toBeVisible();
  await page.getByRole('button', { name: /连接到 judge_a/ }).click();
  await expect(page.getByText(/已新增连线：answer-judge_a/)).toBeVisible();

  await page.getByRole('button', { name: /新增 Join/ }).click();
  await expect(page.locator('input[value="Join"]').first()).toBeVisible();

  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByText(/已撤销/)).toBeVisible();
  await page.getByRole('button', { name: '重做' }).click();
  await expect(page.getByText(/已重做/)).toBeVisible();

  await page.getByRole('button', { name: /校验当前画布/ }).click();
  await expect(page.getByText(/校验通过|校验失败/)).toBeVisible();

  await page.getByRole('button', { name: /校验并发布/ }).click();
  await expect(page.getByText(/发布成功/).first()).toBeVisible();
});

test('Workflow 画布支持节点工具栏和键盘删除', async ({ page }) => {
  await createRagWorkflowDraft(page, `E2E 删除 ${Date.now()}`);

  await page.getByRole('button', { name: /删除当前节点/ }).click();
  await expect(page.getByText(/已删除节点：answer/)).toBeVisible();

  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByText(/已撤销/)).toBeVisible();

  await page.keyboard.press('Delete');
  await expect(page.getByText(/已删除节点：answer/)).toBeVisible();
});

test('Workflow 草稿保存后可以从市场重新打开并保留配置', async ({ page }) => {
  const workflowName = `E2E 保存回放 ${Date.now()}`;
  await createRagWorkflowDraft(page, workflowName);

  await page.locator('input[value="生成回答"]').fill('生成回答已保存');
  await page.getByRole('button', { name: /保存草稿/ }).click();

  await expect(page.getByText(new RegExp(`草稿已保存：${escapeRegExp(workflowName)}`)).first()).toBeVisible();
  await page.getByRole('button', { name: '返回市场' }).click();
  await expect(page.getByText('Workflow 资产市场')).toBeVisible();
  await page.getByPlaceholder('搜索 Workflow 名称').fill(workflowName);
  await expect(page.getByRole('row', { name: new RegExp(workflowName) })).toBeVisible();
  await page.getByRole('row', { name: new RegExp(workflowName) }).getByRole('button', { name: /编辑/ }).click();

  await expect(page.locator(`input[value="${workflowName}"]`)).toBeVisible();
  await expect(page.locator('input[value="生成回答已保存"]')).toBeVisible();
});

test('Workflow 字段映射支持自定义路径编辑并随草稿保存回放', async ({ page }) => {
  const workflowName = `E2E 字段映射 ${Date.now()}`;
  await createRagWorkflowDraft(page, workflowName);

  await page.getByLabel('字段路径 prompt').fill('row.prompt_text');
  await expect(page.locator('input[value="row.prompt_text"]')).toBeVisible();

  await page.getByRole('button', { name: /保存草稿/ }).click();
  await expect(page.getByText(new RegExp(`草稿已保存：${escapeRegExp(workflowName)}`)).first()).toBeVisible();
  await page.getByRole('button', { name: '返回市场' }).click();
  await expect(page.getByText('Workflow 资产市场')).toBeVisible();
  await page.getByPlaceholder('搜索 Workflow 名称').fill(workflowName);
  await page.getByRole('row', { name: new RegExp(workflowName) }).getByRole('button', { name: /编辑/ }).click();

  await expect(page.locator(`input[value="${workflowName}"]`)).toBeVisible();
  await expect(page.locator('input[value="row.prompt_text"]')).toBeVisible();
});

test('Workflow 试运行会使用所选数据集并回填结果', async ({ page }) => {
  const datasetName = `aaa_e2e_dryrun_${Date.now()}`;
  await page.request.post(apiPath('/datasets/source-materialize'), {
    data: {
      name: datasetName,
      rows: [{ question: '什么是 AegisQA?', reference: 'AI 评测平台', expected_label: 'pass' }],
      golden: true,
      label_field: 'expected_label',
    },
  });

  await createRagWorkflowDraft(page, `E2E 试运行 ${Date.now()}`);
  const datasetSelect = page.getByRole('combobox').nth(1);
  await datasetSelect.click();
  await datasetSelect.fill(datasetName);
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content')
    .filter({ hasText: `${datasetName} v1` })
    .click();
  await page.getByRole('button', { name: /试运行/ }).click();

  const jsonPanel = page.getByRole('tabpanel', { name: 'JSON' });
  await expect(jsonPanel.getByText(/"queue_messages"/)).toBeVisible();
  await expect(jsonPanel.getByText(/"item_id"/)).toBeVisible();
});

function apiPath(pathname: string) {
  return `/api${pathname}`;
}

async function createWorkflowDraft(page: import('@playwright/test').Page, workflowName: string, navigate = true) {
  if (navigate) {
    await page.goto('/workflows');
  }
  await page.getByRole('button', { name: /新建 Workflow/ }).click();
  await page.getByLabel('新建 Workflow 名称').fill(workflowName);
  await page.getByRole('button', { name: '确认创建' }).click();
  await expect(page.getByText('Skill Palette')).toBeVisible();
  await expect(page.getByText('DAG 画布')).toBeVisible();
}

async function createRagWorkflowDraft(page: import('@playwright/test').Page, workflowName: string) {
  const response = await page.request.post(apiPath('/workflow-drafts'), {
    data: {
      name: workflowName,
      graph: createRagGraph(workflowName),
    },
  });
  expect(response.ok()).toBeTruthy();
  const draft = await response.json();
  await page.goto(`/workflows/designer/${draft.draft_id}`);
  await expect(page.getByText('Skill Palette')).toBeVisible();
  await expect(page.getByText('DAG 画布')).toBeVisible();
}

function createRagGraph(name: string) {
  return {
    name,
    nodes: [
      {
        node_id: 'answer',
        node_type: 'skill',
        label: '生成回答',
        skill_ref: 'llm.call@0.1.0',
        input_mapping: { prompt: 'row.question' },
        output_mapping: { answer: 'context.answer', tokens: 'metrics.tokens' },
        config: { model: 'demo-model', temperature: 0 },
        cacheable: true,
      },
      {
        node_id: 'judge_a',
        node_type: 'skill',
        label: '裁判 A',
        skill_ref: 'llm.judge@0.1.0',
        input_mapping: { question: 'row.question', answer: 'context.answer', reference: 'row.reference' },
        output_mapping: { score: 'metrics.judge_a_score', label: 'context.judge_a_label' },
        config: { threshold: 0.6 },
      },
      {
        node_id: 'judge_b',
        node_type: 'skill',
        label: '裁判 B',
        skill_ref: 'llm.judge@0.1.0',
        input_mapping: { question: 'row.question', answer: 'context.answer', reference: 'row.reference' },
        output_mapping: { score: 'metrics.judge_b_score', label: 'context.judge_b_label' },
        config: { threshold: 0.7 },
      },
      { node_id: 'join_quality', node_type: 'join', label: 'Join：等待两个裁判' },
      { node_id: 'report', node_type: 'output', label: 'Report：生成报告与 Badcase' },
    ],
    edges: [
      { source: 'answer', target: 'judge_a' },
      { source: 'answer', target: 'judge_b' },
      { source: 'judge_a', target: 'join_quality' },
      { source: 'judge_b', target: 'join_quality' },
      { source: 'join_quality', target: 'report' },
    ],
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
