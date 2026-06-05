import { expect, test } from '@playwright/test';

import { createTaskFlowFixture, uploadAndApproveSkill, uploadDataset } from './task-flow-helpers';

test('数据集页空列表不展示 demo 字段预览', async ({ page }) => {
  await page.route('**/api/datasets', async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.goto('/datasets');

  await expect(page.getByText('字段预览与类型修正')).toBeVisible();
  await expect(page.getByText('暂无 Dataset Version，请先上传 CSV/JSONL 或通过 Source Skill 物化数据。')).toBeVisible();
  await expect(page.getByText('row.question')).toHaveCount(0);
});

test('上传阶段可以上传 Dataset 与 Agent Skill 包并完成审批', async ({ page }, testInfo) => {
  const fixture = createTaskFlowFixture(testInfo, 'upload');

  await uploadDataset(page, fixture.datasetPath, fixture.datasetName);
  await uploadAndApproveSkill(page, fixture.skillPackagePath, fixture.skillId);
});
