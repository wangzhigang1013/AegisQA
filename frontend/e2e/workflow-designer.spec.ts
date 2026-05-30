import { expect, test } from '@playwright/test';

test('Workflow 画布可以从 Palette 新增 Source、Skill、Join、Output', async ({ page }) => {
  await page.goto('/workflows');
  await page.getByRole('button', { name: /新建 Workflow/ }).click();

  await page.getByRole('button', { name: /新增 Source/ }).click();
  await expect(page.locator('input[value="Source"]').first()).toBeVisible();

  await page.getByRole('button', { name: /Deterministic LLM Call/ }).click();
  await expect(page.locator('input[value="Deterministic LLM Call"]').first()).toBeVisible();

  await page.getByRole('button', { name: /新增 Join/ }).click();
  await expect(page.locator('input[value="Join"]').first()).toBeVisible();

  await page.getByRole('button', { name: /新增 Output/ }).click();
  await expect(page.locator('input[value="Output"]').first()).toBeVisible();
});

test('Workflow 画布可以新增、删除、校验并发布流程', async ({ page }) => {
  await page.goto('/workflows');
  await page.getByRole('button', { name: /新建 Workflow/ }).click();

  await expect(page.getByText('Skill Palette')).toBeVisible();
  await expect(page.getByText('DAG 画布')).toBeVisible();

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

  await page.getByRole('button', { name: /删除选中/ }).click();
  await expect(page.getByText(/已删除节点/)).toBeVisible();

  await page.getByRole('button', { name: '校验' }).click();
  await expect(page.getByText(/校验通过|校验失败/)).toBeVisible();

  await page.getByRole('button', { name: '发布' }).click();
  await expect(page.getByText(/发布成功/)).toBeVisible();
});

test('Workflow 画布支持节点工具栏和键盘删除', async ({ page }) => {
  await page.goto('/workflows');
  await page.getByRole('button', { name: /新建 Workflow/ }).click();

  await page.getByRole('button', { name: /删除当前节点/ }).click();
  await expect(page.getByText(/已删除节点：answer/)).toBeVisible();

  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByText(/已撤销/)).toBeVisible();

  await page.keyboard.press('Delete');
  await expect(page.getByText(/已删除节点：answer/)).toBeVisible();
});
