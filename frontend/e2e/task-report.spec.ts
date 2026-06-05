import { expect, test } from '@playwright/test';

import {
  createTaskByApi,
  createTaskFlowFixture,
  executeTaskByApi,
  materializeDataset,
  publishPluginWorkflow,
  uploadAndApproveSkillByApi,
  verifyReportAndCorrectBadcase,
} from './task-flow-helpers';

test('报告阶段可以加载真实执行结果并沉淀 Badcase', async ({ page, request }, testInfo) => {
  const fixture = createTaskFlowFixture(testInfo, 'report');

  const dataset = await materializeDataset(request, fixture.datasetName);
  await uploadAndApproveSkillByApi(request, fixture.skillPackagePath, fixture.skillId);
  const workflow = await publishPluginWorkflow(request, fixture.workflowName, fixture.skillId);
  const task = await createTaskByApi(request, fixture.taskName, dataset.dataset_id, dataset.version, workflow.version_id);
  const execution = await executeTaskByApi(request, task.task_id);

  await verifyReportAndCorrectBadcase(page, fixture.taskName);

  expect(execution.status).toBe('completed');
});
