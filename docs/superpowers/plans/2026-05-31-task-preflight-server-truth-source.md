# Task Preflight Server Truth Source 计划

## 背景

服务端已经能识别“过期 Preflight 签名”，但如果调用方伪造一个与当前请求参数匹配、状态为 `passed` 的 `preflight_result`，旧逻辑仍会信任客户端状态并创建任务。这会让直接 API 调用绕过字段映射、Skill 审批、预算等真实阻断项。

## 实施内容

1. 服务端重算 Preflight
   - `POST /tasks` 创建任务前永远根据当前请求构造 `TaskPreflightRequest` 并调用 `_build_task_preflight`。
   - 客户端传入的 `preflight_result` 只用于 `_ensure_preflight_matches_task_request` 判断是否过期。
   - 任务最终保存和阻断判断都使用服务端重算结果。

2. 回归测试
   - 构造缺少 `reference` 字段的数据集。
   - 提交伪造的 `status=passed` Preflight。
   - 断言服务端仍返回 `TASK_PREFLIGHT_BLOCKED`，且阻断项为 `field_mapping`。

## 验证

- `python -m pytest tests\test_task_center_api.py -q -k recomputes_preflight`
- `python -m pytest tests\test_task_center_api.py -q -k "recomputes_preflight or stale_preflight"`
- `python -m pytest tests\test_task_center_api.py -q -k "execution_templates"`
- `python -m pytest -q`
- `cd frontend && npm run typecheck`
- `cd frontend && npm test`
- `cd frontend && npm run build`
- `cd frontend && npm run e2e`

## 结果

- 后端全量：90 passed，Windows `.pytest_cache` 仍有创建警告，不影响结果。
- 前端全量：4 个测试文件，61 passed。
- TypeScript 与生产构建：通过。
- Playwright E2E：8 passed。
