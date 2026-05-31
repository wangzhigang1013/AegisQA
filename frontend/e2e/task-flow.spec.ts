import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';

test('上传数据、审批 Skill、发布 Workflow、执行任务并沉淀 Badcase', async ({ page, request }, testInfo) => {
  const stamp = Date.now();
  const workspace = testInfo.outputPath('fixtures');
  mkdirSync(workspace, { recursive: true });

  const datasetName = `e2e_dataset_${stamp}`;
  const skillId = `plugin.e2e_echo_${stamp}@0.1.0`;
  const workflowName = `E2E 插件评测 Workflow ${stamp}`;
  const taskName = `E2E 任务 ${stamp}`;
  const datasetPath = path.join(workspace, 'samples.jsonl');
  const skillPackagePath = path.join(workspace, 'echo_skill.zip');

  writeJsonlFixture(datasetPath);
  writeSkillPackage(skillPackagePath, skillId);

  await uploadDataset(page, datasetPath, datasetName);
  await uploadAndApproveSkill(page, skillPackagePath, skillId);

  await page.goto('/workflows');
  await page.getByRole('button', { name: /新建 Workflow/ }).click();
  await expect(page.getByText('Skill Palette')).toBeVisible();

  const workflow = await publishPluginWorkflow(request, workflowName, skillId);
  await page.goto('/workflows');
  await page.getByPlaceholder('搜索 Workflow 名称').fill(workflowName);
  await expect(page.getByText(workflowName)).toBeVisible();

  await createAndExecuteTask(page, datasetName, workflowName, taskName);
  await verifyTaskSearch(page, taskName);
  await verifyReportAndCorrectBadcase(page, taskName);

  expect(workflow.version_id).toContain(':v');
});

async function uploadDataset(page: Page, datasetPath: string, datasetName: string) {
  await page.goto('/datasets');
  await page.getByRole('button', { name: /上传 CSV \/ JSONL/ }).click();
  await page.locator('.ant-modal input[type="file"]').setInputFiles(datasetPath);
  await page.getByPlaceholder('例如：rag_regression_2026_05').fill(datasetName);
  await page.getByLabel('标记为 Golden Dataset').check();
  await page.getByPlaceholder('expected_label').fill('expected_label');
  await page.getByRole('button', { name: '提交上传' }).click();
  await expect(page.getByText(new RegExp(`上传成功：${datasetName}`))).toBeVisible();
}

async function uploadAndApproveSkill(page: Page, skillPackagePath: string, skillId: string) {
  await page.goto('/skills');
  await page.getByRole('button', { name: /上传 Skill 插件包/ }).click();
  await page.locator('.ant-modal input[type="file"]').setInputFiles(skillPackagePath);
  await page.getByRole('button', { name: '提交上传' }).click();
  await expect(page.getByText(new RegExp(`插件包已上传：${escapeRegExp(skillId)}`))).toBeVisible();

  await page.getByPlaceholder('搜索 Skill 名称或 ID').fill(skillId);
  const skillRow = page.locator('tr').filter({ hasText: skillId });
  await skillRow.getByRole('button', { name: /查看详情/ }).click();
  await page.getByRole('button', { name: /运行合约测试/ }).click();
  await expect(page.getByText(new RegExp(`合约测试通过：${escapeRegExp(skillId)}`)).first()).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/governance');
  await page.getByPlaceholder('搜索 Skill ID 或名称').fill(skillId);
  const governanceRow = page.locator('tr').filter({ hasText: skillId });
  await governanceRow.getByRole('button', { name: /启\s*用/ }).click();
  await expect(page.getByText(new RegExp(`Skill 状态已更新：${escapeRegExp(skillId)} / approved`))).toBeVisible();
}

async function publishPluginWorkflow(request: import('@playwright/test').APIRequestContext, workflowName: string, skillId: string) {
  const response = await request.post(apiPath('/workflow-graphs/publish'), {
    data: {
      graph: {
        name: workflowName,
        nodes: [
          {
            node_id: 'plugin_answer',
            node_type: 'skill',
            label: '插件生成回答',
            skill_ref: skillId,
            input_mapping: { question: 'row.question' },
            output_mapping: { answer: 'context.answer' },
            config: {},
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
          { source: 'plugin_answer', target: 'judge' },
          { source: 'judge', target: 'report' },
        ],
      },
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createAndExecuteTask(page: Page, datasetName: string, workflowName: string, taskName: string) {
  await page.goto('/runs');
  await page.getByRole('button', { name: /创建任务/ }).click();
  await page.getByPlaceholder('例如：RAG 回归评测 2026-05-31').fill(taskName);

  await selectModalOption(page, 'Dataset Version', datasetName);
  await selectModalOption(page, 'Workflow Version', workflowName);

  await page.getByRole('button', { name: /运行 Preflight/ }).click();
  await expect(page.getByText(/Preflight 完成/)).toBeVisible();
  await page.getByRole('button', { name: '确认创建任务' }).click();
  await expect(page.getByText(new RegExp(`任务已创建：${escapeRegExp(taskName)}`))).toBeVisible();

  await page.getByRole('dialog').getByRole('button', { name: '执行' }).click();
  await expect(page.getByText(/任务状态已更新：completed/)).toBeVisible();
  await expect(page.getByRole('tab', { name: '概览' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Trace' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Attempts' })).toBeVisible();
  await page.getByRole('tab', { name: '参数' }).click();
  await expect(page.getByText('任务冻结参数')).toBeVisible();
  await expect(page.getByText(/cost_budget|concurrency/)).toBeVisible();
}

async function verifyReportAndCorrectBadcase(page: Page, taskName: string) {
  await page.goto('/reports');
  await openSelectByLabel(page, '选择报告任务');
  const reportSearchRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/api/tasks') && url.searchParams.get('q') === taskName && url.searchParams.get('page_size') === '20';
  });
  await page.getByRole('combobox', { name: '选择报告任务' }).fill(taskName);
  await reportSearchRequest;
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content')
    .filter({ hasText: `${taskName} / completed` })
    .click();

  await expect(page.getByRole('row', { name: new RegExp(`^任务 ${escapeRegExp(taskName)}$`) })).toBeVisible();
  await expect(page.getByText('Badcase 明细')).toBeVisible();
  await page.getByRole('button', { name: /导出 HTML/ }).click();
  await expect(page.getByText(/报告导出成功/)).toBeVisible();

  await page.getByRole('button', { name: /^加入 Golden$/ }).first().click();
  await expect(page.getByText(/Badcase 已加入 Golden 候选/)).toBeVisible();

  await page.getByRole('link', { name: /查看 Trace Flow/ }).click();
  await expect(page.getByRole('heading', { name: 'Trace Flow' })).toBeVisible();
  await expect(page.getByText('队列消息')).toBeVisible();
  await expect(page.getByText('item_id')).toBeVisible();
  await expect(page.getByText(/plugin_answer/).first()).toBeVisible();
  await expect(page.getByText(/llm\.judge@0\.1\.0/).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Steps' }).click();
  await page.getByRole('tab', { name: '参数' }).first().click();
  await expect(page.getByText(/parameter_trace|workflow_config|schema_default/)).toBeVisible();
}

async function verifyTaskSearch(page: Page, taskName: string) {
  await page.goto('/runs');
  const taskSearchRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/api/tasks') && url.searchParams.get('q') === taskName && url.searchParams.get('page') === '1' && url.searchParams.get('page_size') === '8';
  });
  await page.getByPlaceholder('搜索任务名 / 数据源 / Workflow').fill(taskName);
  await taskSearchRequest;
  await expect(page.locator('tr').filter({ hasText: taskName })).toBeVisible();
}

async function selectModalOption(page: Page, label: string, searchText: string) {
  const combobox = page.getByRole('dialog').getByRole('combobox', { name: label });
  await combobox.click();
  await combobox.fill(searchText);
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content')
    .filter({ hasText: searchText })
    .first()
    .click();
}

async function openSelectByLabel(page: Page, label: string) {
  await page
    .locator('.ant-select')
    .filter({ has: page.getByRole('combobox', { name: label }) })
    .locator('.ant-select-selector')
    .click();
}

function writeJsonlFixture(filePath: string) {
  const rows = [
    { question: 'AegisQA 如何保障质量?', reference: 'AegisQA', expected_label: 'pass' },
    { question: '这个样本应该形成坏例', reference: 'Badcase', expected_label: 'fail' },
  ];
  writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n'), 'utf-8');
}

function writeSkillPackage(filePath: string, skillId: string) {
  const script = `
import json
import sys
import zipfile

file_path = sys.argv[1]
skill_id = sys.argv[2]
manifest = {
    "skill_id": skill_id,
    "name": "E2E Echo Skill",
    "version": "0.1.0",
    "description": "端到端测试上传的插件 Skill。",
    "author": "E2E",
    "tags": ["plugin", "e2e"],
    "scenarios": ["task_flow"],
    "input_schema": {"type": "object", "properties": {"question": {"type": "string"}}, "required": ["question"]},
    "output_schema": {"type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"]},
    "config_schema": {"type": "object", "properties": {}},
    "example_input": {"question": "AegisQA 如何保障质量?"},
    "example_config": {},
    "permissions": [],
    "cacheable": True,
}
handler = '''
def run(inputs, config):
    question = inputs["question"]
    return {"output": {"answer": f"插件回答：{question}"}, "metrics": {"plugin_chars": len(question)}, "logs": ["e2e-ok"]}
'''
with zipfile.ZipFile(file_path, "w") as archive:
    archive.writestr("skill.json", json.dumps(manifest, ensure_ascii=False))
    archive.writestr("handler.py", handler)
`;
  execFileSync('python', ['-c', script, filePath, skillId], { stdio: 'pipe' });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function apiPath(pathname: string) {
  return `/api${pathname}`;
}
