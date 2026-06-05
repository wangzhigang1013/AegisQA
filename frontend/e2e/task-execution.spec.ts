import { expect, test } from '@playwright/test';

import {
  createAndExecuteTask,
  createTaskFlowFixture,
  materializeDataset,
  publishPluginWorkflow,
  uploadAndApproveSkillByApi,
  verifyTaskSearch,
} from './task-flow-helpers';

test('执行阶段可以在执行中心真实创建并运行任务', async ({ page, request }, testInfo) => {
  const fixture = createTaskFlowFixture(testInfo, 'execution');

  const dataset = await materializeDataset(request, fixture.datasetName);
  await uploadAndApproveSkillByApi(request, fixture.skillPackagePath, fixture.skillId);
  const workflow = await publishPluginWorkflow(request, fixture.workflowName, fixture.skillId);

  await createAndExecuteTask(page, fixture.datasetName, fixture.workflowName, fixture.taskName);
  await verifyTaskSearch(page, fixture.taskName);

  expect(dataset.dataset_id).toBeTruthy();
  expect(workflow.version_id).toContain(':v');
});
