# Task Report Export Format Actions 实施计划

## 背景

报告中心已经能触发真实下载，但按钮文案仍是“导出 HTML / CSV”，实际只导出 HTML。这个交互会让用户不清楚是否同时导出了两种文件，也无法直接拿到 JSON。任务报告属于一次评测的交付物，导出动作必须明确、可预测。

## 目标

- 把导出入口拆成 HTML、CSV、JSON 三个独立按钮。
- 每个按钮调用 Task 级导出的对应 `file_format`。
- 下载文件名后缀与格式一致。
- 保留当前 Blob 下载和安全文件名逻辑。

## 实施步骤

1. 先写失败测试，断言报告中心存在 CSV 和 JSON 导出动作，并分别调用 `file_format=csv|json`。
2. 把导出 mutation 改成接收 `ReportExportFormat` 参数。
3. 将页头导出入口改成 `Space.Compact` 三按钮组。
4. 每个按钮独立传入格式，并在当前导出请求期间禁用其他格式按钮。
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

- CSV 导出补 Badcase 明细、分层分析、质量决策和参数治理字段。
- HTML 导出补目录、样式、可打印布局和修复任务入口。
