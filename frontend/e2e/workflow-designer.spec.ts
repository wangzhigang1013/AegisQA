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

  await page.getByRole('button', { name: /新增 Aggregator/ }).click();
  await page.getByText('均值').click();
  await expect(page.getByText(/聚合策略已更新：mean/)).toBeVisible();

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

test('Workflow 草稿保存后可以从市场重新打开并保留配置', async ({ page }) => {
  const workflowName = `E2E 保存回放 ${Date.now()}`;
  await page.goto('/workflows');
  await page.getByRole('button', { name: /新建 Workflow/ }).click();

  await page.locator('input[value="未命名 Workflow"]').fill(workflowName);
  await page.locator('input[value="生成回答"]').fill('生成回答已保存');
  await page.getByRole('button', { name: /保存草稿/ }).click();

  await expect(page.getByText('Workflow 资产市场')).toBeVisible();
  await page.getByPlaceholder('搜索 Workflow 名称').fill(workflowName);
  await expect(page.getByRole('row', { name: new RegExp(workflowName) })).toBeVisible();
  await page.getByRole('row', { name: new RegExp(workflowName) }).getByRole('button', { name: /进入画布/ }).click();

  await expect(page.locator(`input[value="${workflowName}"]`)).toBeVisible();
  await expect(page.locator('input[value="生成回答已保存"]')).toBeVisible();
});

test('Workflow 试运行会使用所选数据集并回填结果', async ({ page }) => {
  const datasetName = `aaa_e2e_dryrun_${Date.now()}`;
  await page.request.post('http://127.0.0.1:8000/datasets/source-materialize', {
    data: {
      name: datasetName,
      rows: [{ question: '什么是 AegisQA?', reference: 'AI 评测平台', expected_label: 'pass' }],
      golden: true,
      label_field: 'expected_label',
    },
  });

  await page.goto('/workflows');
  await page.getByRole('button', { name: /新建 Workflow/ }).click();
  await page.getByRole('combobox').nth(1).click();
  await page.getByText(`${datasetName} v1`).click();
  await page.getByRole('button', { name: /试运行/ }).click();

  await expect(page.getByText(/试运行完成/)).toBeVisible();
  await expect(page.getByText(/队列消息只携带 item_id/)).toBeVisible();
});
