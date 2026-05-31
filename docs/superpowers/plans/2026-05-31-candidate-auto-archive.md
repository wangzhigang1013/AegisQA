# 候选资产自动归档策略计划

## 背景

候选资产中心已经具备审批、复跑、晋升、baseline 替换、负责人容量限制和批量指派，但缺少清理策略。已拒绝、已晋升、已复跑且长期不再处理的候选会继续堆在默认列表里，影响团队判断“现在真正需要处理什么”。

## 目标

- 新增 `POST /prompt-skill-candidates/bulk-archive`。
- 只归档允许状态内的候选，例如 `rejected`、`promoted`、`retested`、`promotion_rejected`。
- 支持 `stale_before`，只清理早于水位线的终态候选。
- 开放候选、未到清理时间候选、已归档候选进入 skipped 明细。
- 默认候选列表隐藏 `archived`，但 `status=archived` 可查看归档记录。
- 前端候选资产中心新增“归档终态候选”按钮并展示归档/跳过数量。

## 执行步骤

1. 先写后端失败测试，验证终态旧候选归档、开放候选跳过、新候选跳过、默认列表隐藏归档。
2. 实现后端请求模型、路由、归档 helper、审计记录和默认列表过滤。
3. 先写前端失败测试，验证归档按钮存在、调用归档 API、展示归档结果。
4. 补齐前端类型、API client、页面 mutation、状态筛选项和按钮。
5. 同步项目状态、PRD 验收矩阵和交互验收矩阵。
6. 执行后端、前端、构建、E2E 与 diff 检查后提交。

## 验收标准

- 后端目标测试先 RED 后 GREEN。
- 前端目标测试先 RED 后 GREEN。
- `python -m pytest tests\test_task_flow_optimization.py -q` 通过。
- `python -m pytest -q` 通过。
- `cd frontend && npm run typecheck && npm test && npm run build && npm run e2e` 通过。
- `docs/PROJECT_STATUS.md` 记录本批次改动、验证命令、测试结果和下一步。
