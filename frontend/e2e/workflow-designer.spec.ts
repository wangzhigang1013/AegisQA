import { expect, test } from '@playwright/test';

test('Workflow 画布可以新增、删除、校验并发布流程', async ({ page }) => {
  await page.goto('/workflows');
  await page.getByRole('button', { name: /新建 Workflow/ }).click();

  await expect(page.getByText('Skill Palette')).toBeVisible();
  await expect(page.getByText('DAG 画布')).toBeVisible();

  await page.getByRole('button', { name: /新增 Join/ }).click();
  await expect(page.locator('input[value="Join"]').first()).toBeVisible();

  await page.getByRole('button', { name: /删除选中/ }).click();
  await expect(page.getByText(/已删除节点/)).toBeVisible();

  await page.getByRole('button', { name: '校验' }).click();
  await expect(page.getByText(/校验通过|校验失败/)).toBeVisible();

  await page.getByRole('button', { name: '发布' }).click();
  await expect(page.getByText(/发布成功/)).toBeVisible();
});
