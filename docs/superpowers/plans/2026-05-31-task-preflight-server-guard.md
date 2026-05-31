# Task Preflight Server Guard 计划

## 背景

上一批已在前端任务创建向导中做了 Preflight 签名新鲜度校验，但直接调用 `POST /tasks` 仍可能把旧 `preflight_result` 和新的任务参数组合在一起提交。这样会出现“前端不能点，但 API 能绕过”的风险，影响任务创建的稳定性和可解释性。

同时，前端创建任务 mutation 在选择执行参数模板后没有把 `execution_template_id` 写入 `POST /tasks` 请求，模板化任务的 Preflight 签名、任务快照和后端校验可能不一致。

## 实施内容

1. 服务端签名强校验
   - 当请求携带 `preflight_result` 时，`POST /tasks` 会比对 Dataset、Workflow、执行模板、评测目的、质量门槛、repeat、成本预算和 Skill 覆盖。
   - 任一字段不一致时返回 `TASK_PREFLIGHT_STALE`。
   - 错误详情包含 `mismatches`，便于前端或调用方提示用户重新运行 Preflight。

2. 前端模板 ID 提交修复
   - 执行中心创建任务 mutation 补传 `execution_template_id`。
   - App 级交互测试覆盖“选择执行模板 -> 运行 Preflight -> 创建任务”的请求体。

3. 类型同步
   - `TaskPreflightResult` 增加 `skill_overrides` 字段，和后端签名字段保持一致。

## 验证

- `python -m pytest tests\test_task_center_api.py -q -k stale_preflight`
- `cd frontend && npm test -- src/test/App.test.tsx -t "执行中心选择执行模板"`
- `python -m pytest tests\test_task_center_api.py -q -k "stale_preflight or execution_templates"`
- `python -m pytest -q`
- `cd frontend && npm run typecheck`
- `cd frontend && npm test`
- `cd frontend && npm run build`
- `cd frontend && npm run e2e`

## 结果

- 后端全量：89 passed，Windows `.pytest_cache` 仍有创建警告，不影响结果。
- 前端全量：4 个测试文件，61 passed。
- TypeScript 与生产构建：通过。
- Playwright E2E：8 passed。
