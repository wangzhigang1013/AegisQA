# AegisQA 全面优化实施计划

> 基于代码审查 + 行业对标 + 稳定性分析的综合优化方案

**创建时间**: 2026-06-16
**状态**: 待审批
**预计总工时**: 3-4 周

---

## 一、优化范围

本次优化覆盖 5 大维度:

| 维度 | 目标 | 优先级 |
|------|------|--------|
| **功能补全** | Playground/Skill创建/工作流 核心功能真实可用 | P0 |
| **代码质量** | 大文件拆分、类型安全、死代码清理 | P1 |
| **用户体验** | 错误提示、加载状态、操作反馈 | P1 |
| **生产就绪** | Auth 正式化、存储升级、Celery 集成 | P2 |
| **测试覆盖** | 单元测试、集成测试、E2E 覆盖率 | P2 |

---

## 二、文件变更清单

### 需要新建的文件

| 文件路径 | 职责 |
|----------|------|
| `frontend/src/pages/PlaygroundPage.tsx` | 重写 — 接入真实模型网关 |
| `frontend/src/pages/SkillCreatePage.tsx` | 重写 — 生成真实 zip 包 |
| `frontend/src/components/playground/` | Playground 子组件拆分 |
| `frontend/src/components/reports/` | ReportsPage 子组件拆分 |
| `frontend/src/components/governance/` | GovernancePage 子组件拆分 |
| `aegisqa/api/routes/playground.py` | Playground 后端 API |
| `aegisqa/api/routes/auth_db.py` | 数据库用户管理 API |
| `aegisqa/storage/migrations/` | 数据库迁移脚本 |
| `tests/unit/` | 单元测试目录 |
| `tests/integration/` | 集成测试目录 |

### 需要修改的文件

| 文件路径 | 变更内容 |
|----------|----------|
| `aegisqa/api/app.py` | 拆分 — 提取 routes、services、models |
| `aegisqa/api/routes/tasks.py` (141KB) | 拆分为 tasks_crud.py + tasks_lifecycle.py + tasks_reports.py |
| `aegisqa/api/routes/productization.py` (134KB) | 拆分为 ci_gates.py + annotation.py + candidates.py |
| `aegisqa/security/auth.py` | 数据库用户管理替代硬编码 |
| `aegisqa/workers/celery_app.py` | 正式集成 Celery |
| `frontend/src/pages/ReportsPage.tsx` (68KB) | 拆分为 5 个子组件 |
| `frontend/src/pages/GovernancePage.tsx` (62KB) | 拆分为 4 个子组件 |
| `frontend/src/pages/CandidateAssetsPage.tsx` (59KB) | 拆分为 4 个子组件 |
| `frontend/src/api/client.ts` | 增加 Playground API、Auth API |

---

## 三、实施任务

### Phase 1: 功能补全 (Week 1)

#### Task 1.1: Playground 真实化
**目标**: Playground 能真正调用模型网关测试 Prompt

- [ ] **1.1.1** 新建 `aegisqa/api/routes/playground.py`
  - `POST /playground/execute` — 调用 `ModelGateway.generate()`
  - 支持: prompt 模板、变量注入、模型选择、temperature/max_tokens
  - 返回: output、latency_ms、usage(tokens)
  - 文件: `aegisqa/api/routes/playground.py` (新建)

- [ ] **1.1.2** 前端 PlaygroundPage 接入真实 API
  - `executeMutation` 调用 `POST /playground/execute`
  - 流式输出用 SSE 或轮询
  - 版本历史存储到 localStorage
  - 文件: `frontend/src/pages/PlaygroundPage.tsx`

- [ ] **1.1.3** Playground LLM-as-Judge 功能
  - 开关启用后，自动用第二个模型调用评判
  - 评判 Prompt 模板可编辑
  - 返回结构化评分 (score/label/dimensions)
  - 文件: `frontend/src/pages/PlaygroundPage.tsx`

- [ ] **1.1.4** Playground 批量测试
  - 上传 CSV/JSONL 数据集
  - 批量替换变量并执行
  - 统计通过率、平均分
  - 文件: `frontend/src/pages/PlaygroundPage.tsx`, `aegisqa/api/routes/playground.py`

#### Task 1.2: Skill 创建页真实化
**目标**: Skill 创建页能生成真实可执行的 Skill 包

- [ ] **1.2.1** 代码模式 — Monaco Editor 集成
  - 替换 textarea 为 Monaco Editor
  - 语法高亮、自动补全、错误提示
  - 实时推断 input_schema/output_schema
  - 文件: `frontend/src/pages/SkillCreatePage.tsx`, `frontend/package.json`

- [ ] **1.2.2** API 模式 — 真实 API 测试
  - 填写 URL 后，发送测试请求验证连通性
  - 自动解析响应 JSON 推断 Schema
  - 支持 Header 认证 (Bearer/API Key)
  - 文件: `frontend/src/pages/SkillCreatePage.tsx`

- [ ] **1.2.3** 指令模式 — 实时预览
  - 编辑指令后，点击"预览"发送到模型
  - 显示模型返回结果
  - 支持引用数据集字段作为变量
  - 文件: `frontend/src/pages/SkillCreatePage.tsx`

#### Task 1.3: 工作流设计器增强
**目标**: 工作流设计器更易用、更稳定

- [ ] **1.3.1** 节点搜索与过滤
  - Skill 面板增加搜索框
  - 按类型/名称/标签过滤
  - 文件: `frontend/src/pages/workflowDesigner/SkillPalettePanel.tsx`

- [ ] **1.3.2** 画布小地图增强
  - 小地图显示节点颜色
  - 点击小地图跳转
  - 文件: `frontend/src/pages/workflowDesigner/WorkflowCanvasPanel.tsx`

- [ ] **1.3.3** 节点复制粘贴
  - Ctrl+C/V 复制选中节点
  - 自动重命名 node_id
  - 保留配置和连线
  - 文件: `frontend/src/pages/WorkflowDesignerPage.tsx`

### Phase 2: 代码质量 (Week 2)

#### Task 2.1: 大文件拆分

- [ ] **2.1.1** ReportsPage 拆分 (68KB → 5 个组件)
  - `ReportSummaryCards.tsx` — 概览卡片
  - `ReportSegmentTable.tsx` — 分段分析表
  - `ReportBadcaseList.tsx` — Badcase 列表
  - `ReportExportPanel.tsx` — 导出功能
  - `ReportRootCause.tsx` — 根因分析
  - 文件: `frontend/src/components/reports/` (新建目录)

- [ ] **2.1.2** GovernancePage 拆分 (62KB → 4 个组件)
  - `SkillGovernancePanel.tsx` — Skill 审批
  - `ModelGatewayPanel.tsx` — 模型网关配置
  - `AuditEventPanel.tsx` — 审计事件
  - `RuntimeStatusPanel.tsx` — 运行时状态
  - 文件: `frontend/src/components/governance/` (新建目录)

- [ ] **2.1.3** CandidateAssetsPage 拆分 (59KB → 4 个组件)
  - `CandidateListPanel.tsx` — 候选列表
  - `CandidateReviewPanel.tsx` — 审核操作
  - `CandidateRetestPanel.tsx` — 重测计划
  - `BaselinePanel.tsx` — 基线管理
  - 文件: `frontend/src/components/candidates/` (新建目录)

- [ ] **2.1.4** 后端 app.py 拆分 (100KB)
  - 提取 Pydantic models → `aegisqa/api/models/`
  - 提取 helper functions → `aegisqa/api/helpers/`
  - 保留 `create_app()` 和 middleware
  - 文件: `aegisqa/api/models/`, `aegisqa/api/helpers/` (新建)

- [ ] **2.1.5** 后端 routes 拆分
  - `tasks.py` (141KB) → `tasks_crud.py` + `tasks_lifecycle.py` + `tasks_reports.py`
  - `productization.py` (134KB) → `ci_gates.py` + `annotation.py` + `candidates.py`
  - 文件: `aegisqa/api/routes/` (拆分)

#### Task 2.2: 类型安全提升

- [ ] **2.2.1** 前端 API 响应类型完善
  - 为所有 `api.xxx()` 调用添加返回类型
  - 消除 `as unknown as` 和 `as any` 类型断言
  - 文件: `frontend/src/api/client.ts`, `frontend/src/types/`

- [ ] **2.2.2** 后端 Pydantic 模型对齐
  - 确保所有 API 响应有对应的 ResponseModel
  - 消除 `dict[str, Any]` 返回类型
  - 文件: `aegisqa/api/routes/*.py`

#### Task 2.3: 死代码清理

- [ ] **2.3.1** 移除未使用的导入和变量
  - 全局扫描 `# noqa` 注释，评估是否必要
  - 移除 `debug_conflict.log` 残留
  - 文件: 全局

- [ ] **2.3.2** 移除 Mock 数据
  - PlaygroundPage mock 输出 → 已修复
  - SkillCreatePage mock 测试 → 已修复
  - 检查其他页面的 mock 数据
  - 文件: `frontend/src/pages/*.tsx`

### Phase 3: 用户体验 (Week 3)

#### Task 3.1: 错误处理统一

- [ ] **3.1.1** 全局错误 Toast 组件
  - 新建 `ErrorToast` 组件
  - 支持: success/error/warning/info
  - 自动消失 (5s)、手动关闭
  - 文件: `frontend/src/components/ui/ErrorToast.tsx` (新建)

- [ ] **3.1.2** API 错误统一处理
  - `client.ts` 的 `request()` 统一捕获错误
  - 401 → 跳转登录页
  - 403 → 显示权限不足提示
  - 429 → 显示限流提示
  - 500 → 显示"服务异常，请稍后重试"
  - 文件: `frontend/src/api/client.ts`

- [ ] **3.1.3** 表单校验统一
  - 所有表单提交前校验必填字段
  - 校验失败显示红色提示
  - 文件: 各表单页面

#### Task 3.2: 加载状态优化

- [ ] **3.2.1** 骨架屏组件
  - 新建 `Skeleton` 组件
  - 用于列表页、详情页加载状态
  - 文件: `frontend/src/components/ui/Skeleton.tsx` (新建)

- [ ] **3.2.2** 列表页加载状态
  - 首次加载显示骨架屏
  - 刷新时显示顶部进度条
  - 空状态显示引导文案
  - 文件: 各列表页

#### Task 3.3: 操作反馈优化

- [ ] **3.3.1** 操作确认对话框
  - 删除、归档、禁用等危险操作需要确认
  - 显示操作影响范围
  - 文件: `frontend/src/components/ui/ConfirmDialog.tsx` (新建)

- [ ] **3.3.2** 批量操作进度
  - 批量审核、批量重测等操作显示进度
  - 支持取消
  - 文件: 各批量操作页面

### Phase 4: 生产就绪 (Week 4)

#### Task 4.1: Auth 正式化

- [ ] **4.1.1** 用户数据表
  - 新建 `users` 表 (id, username, password_hash, role, display_name, enabled, created_at)
  - 迁移脚本: 从硬编码用户导入
  - 文件: `aegisqa/storage/migrations/001_users.py` (新建)

- [ ] **4.1.2** 用户管理 API
  - `POST /auth/register` — 注册
  - `POST /auth/login` — 登录 (返回 JWT)
  - `GET /auth/me` — 当前用户
  - `PUT /auth/password` — 修改密码
  - 文件: `aegisqa/api/routes/auth_db.py` (新建)

- [ ] **4.1.3** 前端登录页
  - 登录表单
  - Token 存储到 localStorage
  - 自动刷新 Token
  - 文件: `frontend/src/pages/LoginPage.tsx` (新建)

#### Task 4.2: 测试覆盖

- [ ] **4.2.1** 后端单元测试
  - 模型网关重试逻辑
  - DAG 条件解析器
  - Skill 检测器
  - 文件: `tests/unit/` (新建)

- [ ] **4.2.2** 前端组件测试
  - SkillCreatePage 三种模式
  - PlaygroundPage 执行流程
  - WorkflowDesignerPage 节点操作
  - 文件: `frontend/src/**/*.test.tsx`

- [ ] **4.2.3** E2E 测试扩展
  - Skill 上传 → 合约测试 → 审批 完整流程
  - 工作流 创建 → 发布 → 执行 完整流程
  - 文件: `tests/frontend_e2e.py`

---

## 四、验收标准

### Phase 1 验收
- [ ] Playground 能真实调用模型并返回结果
- [ ] Skill 创建页能生成可执行的 zip 包
- [ ] 工作流设计器支持节点搜索和复制

### Phase 2 验收
- [ ] 所有大文件拆分到 <30KB
- [ ] TypeScript 类型覆盖率 >90%
- [ ] 无死代码、无 mock 数据

### Phase 3 验收
- [ ] 所有错误有友好提示
- [ ] 所有列表页有骨架屏
- [ ] 危险操作有确认对话框

### Phase 4 验收
- [ ] 用户可通过注册/登录使用
- [ ] 核心模块单元测试覆盖率 >70%
- [ ] E2E 测试覆盖完整业务流程

---

## 五、依赖关系

```
Phase 1 (功能补全) ──→ Phase 3 (用户体验)
       │                      │
       └──→ Phase 2 (代码质量) ──→ Phase 4 (生产就绪)
```

Phase 1 和 Phase 2 可以并行执行。
Phase 3 依赖 Phase 1 的功能补全。
Phase 4 依赖 Phase 2 的代码质量。

---

## 六、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 大文件拆分引入回归 | 高 | 每次拆分后运行 E2E 测试 |
| Monaco Editor 包体积大 | 中 | 按需加载、代码分割 |
| Celery 集成复杂度高 | 中 | 先用 ThreadPoolExecutor 过渡 |
| 数据库迁移数据丢失 | 高 | 迁移前备份、支持回滚 |
