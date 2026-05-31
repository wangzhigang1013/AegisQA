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
  await request.post(apiPath(`/tasks/${task.task_id}/execute`));

  await page.goto('/ci-gates');
  await page.getByRole('button', { name: /创建质量门禁/ }).click();
  await page.getByPlaceholder('例如：发布质量门禁').fill(gateName);
  await page.getByLabel('说明').fill('E2E 验证低通过率任务会被阻断。');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText(new RegExp(`质量门禁配置已创建：${escapeRegExp(gateName)}`))).toBeVisible();

  await selectTask(page, taskName);
  await page.getByRole('button', { name: /执行 Gate 评估/ }).click();

  await expect(page.getByText('阻断原因')).toBeVisible();
  await expect(page.locator('.ant-alert-message').filter({ hasText: /质量门禁未通过：pass_rate/ })).toBeVisible();
});

test('Annotation Queue 可以领取、审核并回流 Golden', async ({ page, request }) => {
  const stamp = Date.now();
  const datasetName = `e2e_annotation_dataset_${stamp}`;
  const workflowName = `E2E Annotation Workflow ${stamp}`;
  const taskName = `E2E Annotation 任务 ${stamp}`;

  const dataset = await createDataset(request, datasetName);
  const workflow = await publishWorkflow(request, workflowName);
  const task = await createTask(request, taskName, dataset.dataset_id, dataset.version, workflow.version_id);
  const executedTaskResponse = await request.post(apiPath(`/tasks/${task.task_id}/execute`));
  expect(executedTaskResponse.ok()).toBeTruthy();
  const executedTask = await executedTaskResponse.json();

  const seedResponse = await request.post(apiPath('/annotation-queue/seed-from-run'), {
    data: { run_id: executedTask.run_id, strategy: 'all', limit: 5 },
  });
  expect(seedResponse.ok()).toBeTruthy();
  expect((await seedResponse.json()).created_count).toBeGreaterThan(0);

  await page.goto('/annotation-queue');
  await expect(page.getByText('Annotation Queue 人工审核')).toBeVisible();
  await expect(page.getByText(taskName).first()).toBeVisible();

  await page.getByRole('button', { name: /领取/ }).first().click();
  await expect(page.getByText(/样本已领取/)).toBeVisible();

  await page.getByRole('button', { name: /audit 审核/ }).first().click();
  const reviewModal = page.locator('.ant-modal').filter({ has: page.getByText('审核样本', { exact: true }) });
  await reviewModal.getByPlaceholder('例如：pass / fail', { exact: true }).fill('fail');
  await reviewModal.getByLabel('回流 Golden Dataset').check();
  await reviewModal.getByRole('button', { name: /确认审核/ }).click();
  await expect(page.getByText(/审核已提交，并回流 Golden/)).toBeVisible();

  const bulkTaskName = `${taskName} 批量`;
  const bulkTask = await createTask(request, bulkTaskName, dataset.dataset_id, dataset.version, workflow.version_id);
  const executedBulkTaskResponse = await request.post(apiPath(`/tasks/${bulkTask.task_id}/execute`));
  expect(executedBulkTaskResponse.ok()).toBeTruthy();
  const executedBulkTask = await executedBulkTaskResponse.json();
  const bulkSeedResponse = await request.post(apiPath('/annotation-queue/seed-from-run'), {
    data: { run_id: executedBulkTask.run_id, strategy: 'all', limit: 5 },
  });
  expect(bulkSeedResponse.ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByText(bulkTaskName).first()).toBeVisible();
  const bulkRow = page.locator('.ant-table-tbody tr').filter({ hasText: bulkTaskName }).first();
  await bulkRow.locator('.ant-checkbox-input').check({ force: true });
  await expect(page.getByRole('button', { name: /^批量审核$/ })).toBeEnabled();
  await page.getByRole('button', { name: /^批量审核$/ }).click();
  const bulkReviewModal = page.locator('.ant-modal').filter({ has: page.getByText('批量审核样本', { exact: true }) });
  await bulkReviewModal.getByPlaceholder('批量标签，例如：pass / fail').fill('fail');
  await bulkReviewModal.getByLabel('批量回流 Golden Dataset').check();
  await bulkReviewModal.getByRole('button', { name: /确认批量审核/ }).click();
  await expect(page.getByText(/批量审核完成/)).toBeVisible();
  await expect(page.getByText(/Golden \d+ \/ Assertion \d+/).first()).toBeVisible();
});

async function createDataset(request: import('@playwright/test').APIRequestContext, datasetName: string) {
  const response = await request.post(apiPath('/datasets/source-materialize'), {
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
  const response = await request.post(apiPath('/workflow-graphs/publish'), {
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
  const response = await request.post(apiPath('/tasks'), {
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

function apiPath(pathname: string) {
  return `/api${pathname}`;
}
