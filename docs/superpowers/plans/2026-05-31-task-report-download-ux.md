# Task Report Download UX 实施计划

## 背景

任务报告已经有 Task 级导出接口，但报告中心按钮只调用接口并显示“导出成功”。从用户主流程看，跑完任务后需要拿到可交付文件，因此导出动作必须产生真实下载，而不是只有状态提示。

## 目标

- 报告中心点击导出后触发浏览器下载。
- 下载文件名使用任务名，并过滤不适合作为文件名的字符。
- jsdom 测试验证 Blob、object URL 和下载点击被调用。
- 保留后端 Task Report Export 作为导出内容来源。

## 实施步骤

1. 前端先写失败测试，断言点击导出后会创建 Blob、调用下载链接点击，并显示安全文件名。
2. 在 `ReportsPage` 中把导出 mutation 改为返回 `{ exported, task }`，避免异步期间选中任务变化导致文件名错配。
3. 新增下载辅助函数：
   - 读取 `file_format` 推导扩展名和 MIME。
   - 将字符串内容原样写入 Blob，非字符串内容转 JSON。
   - 用任务名生成安全文件名。
   - 创建临时 `a` 标签、触发点击、移除节点、释放 object URL。
4. 同步项目状态和验收矩阵。
5. 执行目标测试和全量验证。

## 验收标准

- 目标测试经历 RED -> GREEN。
- `python -m pytest -q` 通过。
- `cd frontend && npm run typecheck` 通过。
- `cd frontend && npm test` 通过。
- `cd frontend && npm run build` 通过。
- `cd frontend && npm run e2e` 通过。
- `git diff --check` 通过。

## 后续优化

- 把单个“导出 HTML / CSV”按钮拆成 HTML、CSV、JSON 三个明确动作。
- 为 CSV 导出增加 Badcase 明细、分层分析、质量决策和参数治理明细。
- 为 HTML 导出增加目录、样式和可打印布局。
