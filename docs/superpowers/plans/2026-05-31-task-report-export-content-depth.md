# Task Report Export Content Depth 实施计划

## 背景

报告中心已经能按 HTML、CSV、JSON 三种格式下载 Task Report，但 CSV 只有少量 metric 行，HTML 也只是 Preflight 和 Report 两段 JSON。对于一次正式评测来说，离线报告需要能支持复盘、汇报和追责，必须包含质量决策、创建前检查、分层风险和 Badcase 明细。

## 目标

- CSV 导出包含任务指标、Preflight 证据、逐项检查、质量决策、分层分析和 Badcase 明细。
- HTML 导出按章节展示任务摘要、质量决策、Preflight 检查、分层分析、Badcase 明细和完整 Report。
- HTML 动态内容继续转义，避免导出文件被浏览器打开时产生注入风险。
- 保持 JSON 导出返回完整 Task Report payload。

## 实施步骤

1. 后端先写失败测试，断言 CSV/HTML 中存在质量决策、Preflight 检查、分层分析和 Badcase 明细。
2. 将 CSV 构建抽为 `_build_task_report_export_csv`，使用标准库 `csv.writer` 生成结构化行。
3. 将 HTML 构建抽为 `_build_task_report_export_html`，每个章节使用统一 JSON 渲染和 HTML 转义。
4. 保留 `preflight_id` 等旧断言，避免破坏已有导出兼容。
5. 同步项目状态和验收矩阵。
6. 执行目标测试和全量验证。

## 验收标准

- 目标测试经历 RED -> GREEN。
- `python -m pytest -q` 通过。
- `cd frontend && npm run typecheck` 通过。
- `cd frontend && npm test` 通过。
- `cd frontend && npm run build` 通过。
- `cd frontend && npm run e2e` 通过。
- `git diff --check` 通过。

## 后续优化

- 为导出增加权限控制、下载审计和导出历史。
- HTML 导出增加可打印样式和目录。
- CSV 导出按 sheet-like 分区进一步拆分为多文件 zip。
