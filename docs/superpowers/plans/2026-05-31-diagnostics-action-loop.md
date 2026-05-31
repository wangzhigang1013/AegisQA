# Diagnostics Action Loop 深度优化 Implementation Plan

**Goal:** 把任务根因诊断从“解释问题”升级为“直接进入修复动作”，让报告中心能把用户带到 Trace、参数治理、数据血缘、人工审核和质量门禁等后续流程。

**Architecture:** 复用现有 Task Report `diagnostics.next_actions`，前端新增动作处理器 `handleDiagnosticAction`。纯导航动作使用 React Router，变更动作使用 TanStack Query mutation，并在完成后刷新相关缓存和展示明确反馈。

---

### Task 1: 前端红灯测试

- [x] **Step 1: 写交互断言**

在报告中心测试中断言根因诊断动作按钮可见，并点击“加入人工审核”“生成分层门禁”“查看 Trace Flow”“查看参数治理”，确认 API 调用或路由跳转有结果。

- [x] **Step 2: Run RED**

运行：

```powershell
cd frontend
npm test -- src/test/App.test.tsx -t "报告中心围绕任务展示报告"
```

预期：失败，因为当前 next_actions 只是表格文本，不是按钮。

### Task 2: 实现诊断动作闭环

- [x] **Step 1: UI 按钮化**

根因诊断表中把 `next_actions` 渲染为小按钮，并根据 action 类型给出 loading、禁用原因和成功反馈。

- [x] **Step 2: 接真实动作**

支持：

- `open_trace_flow`：跳转 `/tasks/:taskId/trace`。
- `open_parameter_governance`：跳转任务详情参数页。
- `open_dataset_lineage` / `fix_dataset_fields`：跳转数据集页并提示查看 Lineage。
- `seed_annotation_queue`：调用 `seedAnnotationQueue`。
- `create_segment_ci_gate`：调用 `evaluateCIGates` 做即时阻断评估，并提示可去 CI Gate 固化规则。
- `retry_failed_items`：调用 `retryFailedTask`。
- `review_badcases`：滚动到 Badcase 区域并提示复核。
- `audit_judge_profile`：跳转 Judge 审计页。

- [x] **Step 3: Run GREEN**

运行目标测试和类型检查。

### Task 3: 文档、验证和提交

- [x] **Step 1: 更新状态和矩阵**

同步 `docs/PROJECT_STATUS.md`、`docs/PRD_ACCEPTANCE_MATRIX.md`、`docs/INTERACTION_ACCEPTANCE_MATRIX.md`。

- [x] **Step 2: 回归验证**

运行：

```powershell
cd frontend
npm run typecheck
npm test -- src/test/App.test.tsx -t "报告中心围绕任务展示报告"
```

- [x] **Step 3: 提交**

```powershell
git add .
git commit -m "feat: 打通诊断动作闭环"
```
