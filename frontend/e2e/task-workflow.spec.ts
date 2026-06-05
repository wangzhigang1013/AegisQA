import { expect, test } from '@playwright/test';

import {
  createTaskFlowFixture,
  openWorkflowDraft,
  publishPluginWorkflow,
  uploadAndApproveSkillByApi,
  verifyPublishedWorkflowVisible,
} from './task-flow-helpers';

test('Workflow 阶段可以基于已审批 Skill 发布并在市场可见', async ({ page, request }, testInfo) => {
  const fixture = createTaskFlowFixture(testInfo, 'workflow');

  await uploadAndApproveSkillByApi(request, fixture.skillPackagePath, fixture.skillId);
  await openWorkflowDraft(page, fixture.workflowName);

  const workflow = await publishPluginWorkflow(request, fixture.workflowName, fixture.skillId);
  await verifyPublishedWorkflowVisible(page, fixture.workflowName);

  expect(workflow.version_id).toContain(':v');
});
