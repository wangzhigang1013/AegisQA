import { expect, test } from '@playwright/test';

test('CI Gate 可以创建配置并阻断低通过率任务', async ({ page, request }) => {
  const stamp = Date.now();
  const datasetName = `e2e_ci_dataset_${stamp}`;
  const workflowName = `E2E CI Gate Workflow ${stamp}`;
  const taskName = `E2E CI Gate 任务 ${stamp}`;
  const gateName = `E2E 发布质量门禁 ${stamp}`;

  const dataset = await createDataset(request, datasetName);
  const workflow = await publishWorkflow(request, workflowName);
  const task = await createTask(request, taskName, dataset.dataset_id, dataset.version, workflow.version_id);
  await request.post(`http://127.0.0.1:8000/tasks/${task.task_id}/execute`);

  await page.goto('/ci-gates');
  await page.getByRole('button', { name: /创建质量门禁/ }).click();
  await page.getByPlaceholder('例如：发布质量门禁').fill(gateName);
  await page.getByLabel('说明').fill('E2E 验证低通过率任务会被阻断。');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText(new RegExp(`质量门禁配置已创建：${escapeRegExp(gateName)}`))).toBeVisible();

  await selectTask(page, taskName);
  await page.getByRole('button', { name: /执行 Gate 评估/ }).click();

  await expect(page.getByText('阻断原因')).toBeVisible();
  await expect(page.getByText(/质量门禁未通过：pass_rate/)).toBeVisible();
});

async function createDataset(request: import('@playwright/test').APIRequestContext, datasetName: string) {
  const response = await request.post('http://127.0.0.1:8000/datasets/source-materialize', {
    data: {
      name: datasetName,
      rows: [
        { question: 'AegisQA 如何保障质量?', reference: 'AegisQA', expected_label: 'pass' },
        { question: '这个样本应该形成坏例', reference: 'Badcase', expected_label: 'fail' },
      ],
      golden: true,
      label_field: 'expected_label',
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function publishWorkflow(request: import('@playwright/test').APIRequestContext, workflowName: string) {
  const response = await request.post('http://127.0.0.1:8000/workflow-graphs/publish', {
    data: {
      graph: {
        name: workflowName,
        nodes: [
          {
            node_id: 'answer',
            node_type: 'skill',
            label: '生成回答',
            skill_ref: 'llm.call@0.1.0',
            input_mapping: { prompt: 'row.question' },
            output_mapping: { answer: 'context.answer' },
            config: { model: 'demo-model', temperature: 0 },
            cacheable: true,
          },
          {
            node_id: 'judge',
            node_type: 'skill',
            label: '裁判',
            skill_ref: 'llm.judge@0.1.0',
            input_mapping: { question: 'row.question', answer: 'context.answer', reference: 'row.reference' },
            output_mapping: { score: 'metrics.judge_score', label: 'context.judge_label' },
            config: { threshold: 0.6 },
          },
          { node_id: 'report', node_type: 'output', label: '任务报告' },
        ],
        edges: [
          { source: 'answer', target: 'judge' },
          { source: 'judge', target: 'report' },
        ],
      },
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createTask(request: import('@playwright/test').APIRequestContext, taskName: string, datasetId: string, datasetVersion: number, workflowVersionId: string) {
  const response = await request.post('http://127.0.0.1:8000/tasks', {
    data: {
      name: taskName,
      dataset_id: datasetId,
      dataset_version: datasetVersion,
      workflow_version_id: workflowVersionId,
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function selectTask(page: import('@playwright/test').Page, taskName: string) {
  await page.locator('.ant-card').filter({ hasText: 'Gate 评估控制台' }).locator('.ant-select').nth(1).click();
  await page.keyboard.type(taskName);
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content')
    .filter({ hasText: taskName })
    .click();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
