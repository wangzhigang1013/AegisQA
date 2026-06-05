import { expect, test } from '@playwright/test';

import {
  createTaskByApi,
  createTaskFlowFixture,
  executeTaskByApi,
  materializeDataset,
  publishPluginWorkflow,
  uploadAndApproveSkillByApi,
} from './task-flow-helpers';

test('体验工作台串联 Overview、Task、Trace、Report 和 Badcase 修复入口', async ({ page, request }, testInfo) => {
  const fixture = createTaskFlowFixture(testInfo, 'experience');

  const dataset = await materializeDataset(request, fixture.datasetName);
  await uploadAndApproveSkillByApi(request, fixture.skillPackagePath, fixture.skillId);
  const workflow = await publishPluginWorkflow(request, fixture.workflowName, fixture.skillId);
  const task = await createTaskByApi(request, fixture.taskName, dataset.dataset_id, dataset.version, workflow.version_id);
  const execution = await executeTaskByApi(request, task.task_id);
  expect(execution.status).toBe('completed');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'AegisQA 评测工作台' })).toBeVisible();
  await expect(page.getByText(fixture.taskName).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '继续处理', exact: true })).toBeVisible();
  await expect(page.getByText(/查看报告|定位 Badcase/).first()).toBeVisible();

  await page.goto(`/runs?task_id=${task.task_id}`);
  await expect(page.getByRole('dialog', { name: new RegExp(fixture.taskName) })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('completed')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Trace' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '参数' })).toBeVisible();

  await page.goto(`/tasks/${task.task_id}/trace`);
  await expect(page.getByRole('heading', { name: 'Trace Flow' })).toBeVisible();
  await page.getByRole('tab', { name: 'Steps' }).click();
  await expect(page.getByText('诊断标签').first()).toBeVisible();
  await page.getByRole('button', { name: 'Replay Step' }).first().click();
  const stepDebugDialog = page.getByRole('dialog', { name: /Step 调试/ });
  await expect(stepDebugDialog).toBeVisible();
  await expect(stepDebugDialog.getByText(/mock_llm_calls=true/).first()).toBeVisible();
  await stepDebugDialog.getByRole('button', { name: '运行 Prompt Debug' }).click();
  await expect(stepDebugDialog.getByText(/Prompt Debug 已返回历史 prompt trace/).first()).toBeVisible();
  await stepDebugDialog.getByRole('button', { name: '刷新 Repro Bundle' }).click();
  await expect(stepDebugDialog.getByText(/aegisqa.step_repro_bundle.v1/).first()).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Resolved Input' }).first()).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Raw Output' }).first()).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Validated Output' }).first()).toBeVisible();

  await page.goto(`/reports?task_id=${task.task_id}`);
  await expect(page.getByRole('heading', { name: '任务报告' })).toBeVisible();
  await expect(page.getByText('优先结论与动作')).toBeVisible();
  await expect(page.getByRole('button', { name: '进入 Trace Flow 定位失败 Step' })).toBeVisible();
  await page.getByRole('button', { name: '进入 Trace Flow 定位失败 Step' }).click();
  await expect(page.getByRole('heading', { name: 'Trace Flow' })).toBeVisible();

  await page.goto(`/reports?task_id=${task.task_id}`);
  await expect(page.getByText('Badcase 明细', { exact: true })).toBeVisible();
  await page.locator('.ant-table-tbody .ant-checkbox-input').first().check({ force: true });
  await expect(page.getByText('已选 1 条')).toBeVisible();
  await page.getByRole('button', { name: '批量创建修复任务' }).click();
  await expect(page.getByText(/已基于当前报告诊断和 1 条选中 Badcase 生成修复任务/)).toBeVisible();
});
