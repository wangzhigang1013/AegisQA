# 2026-06-01 候选资产中心服务端分页优化计划

## 背景

候选资产中心承接 Repair Task、Annotation Queue 和 Prompt/Skill 版本对比沉淀出的治理资产。旧页面会一次性读取全部候选，再本地分页；当候选资产长期积累后，首屏加载、批量操作和状态筛选都会变慢，也容易让“当前列表”语义混成“全部资产”。

## 目标

- `GET /prompt-skill-candidates` 无分页参数时继续返回数组，兼容既有后端调用。
- `GET /prompt-skill-candidates?page=&page_size=` 返回 `{ items, pagination }`。
- 服务端分页必须先应用 `source_task_id`、`status`、`baseline_experiment_id` 和归档过滤，再分页。
- React 候选资产中心主表改为服务端分页。
- 页面批量审批、批量指派、批量归档保持“当前页候选资产”语义。
- 状态筛选变化时重置到第 1 页。

## 执行步骤

1. 新增后端测试，构造 12 个 Prompt/Skill 候选资产，确认 legacy 数组响应不变。
2. 同一测试确认带 `page=2&page_size=5` 时返回第 2 页和分页元数据。
3. 同一测试确认 `status=approved` 等筛选先于分页执行。
4. 为 `/prompt-skill-candidates` 增加可选分页 Query 参数，复用通用分页 helper。
5. 新增前端分页响应类型与 `api.promptSkillCandidatesPage`。
6. 修改 CandidateAssetsPage 使用服务端分页，并保持批量操作基于当前页候选 ID。
7. 新增前端回归测试，点击第 2 页后断言请求包含 `page=2&page_size=8`。
8. 更新项目状态与验收矩阵。
9. 执行后端、前端、构建、E2E 与空白检查。

## 验收标准

- `python -m pytest tests/test_task_flow_optimization.py -q -k "prompt_skill_candidates_support_server_side_pagination"` 先红后绿。
- `cd frontend && npm test -- src/test/App.test.tsx -t "候选资产中心列表使用服务端分页"` 先红后绿。
- `GET /prompt-skill-candidates` 无分页参数仍返回数组。
- 候选资产中心点击第 2 页会重新请求后端。
- 既有候选审批、生成草稿、复跑、晋升、批量审批、批量指派、归档和逾期升级测试保持通过。
