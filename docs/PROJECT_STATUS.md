# AegisQA 项目状态

## 当前阶段

模型接入配置可用性、导出安全、审计归因、执行器性能、Dashboard/概览首屏轻量化、Run 列表轻量分页、Run Trace 分页、Badcase 列表分页、RunReport 聚合性能、JSON Store 并发稳定性、SQLite 审计流一致性、MySQL JSONL 流并发一致性和 legacy Run HTML 导出安全转义优化完成，生产页面 demo 数据兜底收口继续推进。当前治理页已经把模型服务、Provider 和默认模型都做成下拉/候选式选择；Provider 下拉只暴露 `mock` 与 `openai_compatible` 两个用户语义选项，`deepseek-v4-flash`、`qwen-plus` 等具体模型只能进入默认模型下拉；默认模型搜索只过滤候选，不再把任意搜索词变成可保存选项；前端会把早期误存为模型名的 Provider 自动迁移成 `openai_compatible`，并把原值保留为默认模型候选，后端仍兼容迁移早期误存的 Provider。模型网关配置保存、连接别名增删改和连接测试现在统一要求 `model:configure` 权限；Viewer 会被结构化拒绝并写入 forbidden 审计，Admin 成功操作会记录真实请求 `actor` 与 `role`，且审计日志不会记录明文 API Key。Task 创建、执行、新建 Attempt、暂停、恢复、取消和重试失败项现在具备权限/审计闭环：Viewer 无法控制任务，Evaluator 默认可继续使用执行中心，成功审计记录真实 actor/role；Task Preflight 和执行参数模板创建也已接入 `run:create` 门禁，Viewer 不能创建任务前证据或执行模板，Evaluator 默认兼容旧前端，成功/拒绝审计记录真实 actor/role。legacy Run 创建、执行、取消、暂停、恢复和重试失败项现在也已补齐权限和审计：创建要求 `run:create`，控制动作要求 `run:control`，默认不传 role/actor 的旧脚本仍按 `Evaluator/api` 兼容执行，显式 Viewer 会被结构化拒绝。Judge Profile 创建、一次性 Judge 审计和 Profile 审计现在统一要求 `judge:audit` 权限；默认不传 role/actor 的旧页面和脚本仍按 `Reviewer/api` 兼容执行，显式 Viewer 会被结构化拒绝，成功/拒绝审计记录真实 actor/role。Workflow 草稿创建/更新/删除、草稿发布、Graph 发布、线性发布、复制和归档也已统一走 `workflow:publish` 门禁并记录真实 actor/role，避免可执行资产变更只能追溯到 `api`。Repair Task 生成、领取、指派、完成、重开和后续动作现在统一要求 `badcase:correct`，Viewer 只读角色会被结构化拒绝，成功/拒绝审计记录真实 actor/role，默认 Evaluator 调用保持兼容。Annotation Queue 生成、自动分派、指派、单条审核和批量审核现在统一要求 `annotation:review`，Evaluator/Reviewer 可操作，Viewer 会被结构化拒绝；人工审核候选资产和成功审计会记录真实 actor/role。Candidate Assets 的单条审核、批量审核、批量指派、批量归档、逾期升级、生成 Workflow 草稿、候选复跑、创建晋升审批和晋升审批结论现在统一要求 `candidate:govern`，Evaluator/Reviewer 可操作，Viewer 会被结构化拒绝；成功/拒绝审计记录真实 actor/role，候选复跑和晋升发布资产也不再固定追溯到 `api`。Red Team 扫描、Experiment 快照创建、CI Gate 创建和 CI Gate 评估现在统一要求 `redteam:scan`、`experiment:create`、`ci_gate:manage` 权限；Viewer 会被结构化拒绝，Evaluator 成功审计记录真实 actor/role，避免安全扫描、实验快照和发布门禁资产只能追溯到泛化 `api`。Dataset Source 物化和字段类型修正现在继续要求 `dataset:create` 权限，拒绝审计使用具体动作 `dataset.source_materialize` / `dataset.field_type.correct`，成功审计记录请求 actor/role，避免数据集来源和字段治理动作只能追溯到 `api`。WorkflowRunner 已把 Run 快照落盘改为批量保存，并把暂停/取消信号拆成轻量控制文件；`GET /dashboard/summary` 与 `GET /runs` 显式分页均使用不含 item 明细的轻量摘要；概览页、Experiment 和 CI Gate 不再请求 legacy `/runs` 完整列表；`GET /runs/{run_id}/trace` 和 `GET /badcases` 均支持兼容式服务端分页；`aggregate_run_report` 已收敛为单次遍历 Run Item；`JsonStore.list_json()` 已遵守文档级文件锁，避免 Windows 并发读取 Skill 包列表时阻塞 `os.replace` 写入导致合约测试偶发 500；`SQLiteStore.append_jsonl()` 已用 `BEGIN IMMEDIATE` 串行化 row_index 分配，避免并发审计事件写入撞主键或丢事件；`MySQLStore` 已用 MySQL named lock 串行化同一 JSONL stream 的覆盖写和 append，避免审计事件并发追加重复分配 `row_index`；Skill 上传、审批、禁用、废弃和回滚成功审计现在会记录请求 `actor` 与 `role`，避免关键 Skill 生命周期变更只能追溯到 泛化 `api`；Task 原始结果导出成功审计现在会记录请求 `actor` 与 `role`，避免敏感样本级数据下载只能追溯到 泛化 `api`；Task 结果 CSV 与 Task 报告 CSV 已对 `= + - @` 公式前缀做单引号转义，避免用户样本、Preflight、Badcase 或分层文本被 Excel/WPS 当公式执行；Run 级 legacy HTML 报告导出已对 run_id 和完整 JSON payload 做 HTML escape，避免用户样本或模型输出中的脚本片段进入导出页面；本轮后端全量通过，上一轮 `npm run e2e` 已在 6 workers 下全量 14 passed。


## 最近改动 (Playground & SkillCreate UI优化)
- 彻底重构了 PlaygroundPage.tsx，移除行内样式，引入 .liquid-glass 和 Bento Grid 风格布局。
- 优化了 SkillCreatePage.tsx，采用高级毛玻璃卡片和侧边辅助网格布局展示不同创建模式。
- 补充缺少的 lucide-react 图标，清理样式冗余。
- 执行 
pm run dev -- --force 重启前端。
## 最近改动

- 变更文件：
  - `frontend/src/pages/workflowDesigner/CustomNodes/BaseNode.tsx`
  - `frontend/src/pages/workflowDesigner/CustomNodes/BaseNode.css`
  - `frontend/src/pages/workflowDesigner/CustomNodes/AggregatorNode.tsx`
  - `frontend/src/pages/workflowDesigner/CustomNodes/BranchNode.tsx`
  - `frontend/src/pages/workflowDesigner/CustomNodes/JoinNode.tsx`
  - `frontend/src/pages/workflowDesigner/CustomNodes/OutputNode.tsx`
  - `frontend/src/pages/workflowDesigner/CustomNodes/SkillNode.tsx`
  - `frontend/src/pages/workflowDesigner/CustomNodes/SourceNode.tsx`
  - `frontend/src/pages/workflowDesigner/WorkflowCanvasPanel.tsx`
  - `frontend/src/pages/workflowDesigner/WorkflowDraftLoaderPanel.tsx`
  - `frontend/src/pages/workflowDesigner/WorkflowInspectorPanel.tsx`
  - `frontend/src/pages/WorkflowDesignerPage.tsx`
  - `frontend/src/pages/OverviewPage.tsx`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `frontend/tailwind.config.js`
  - `frontend/src/components/MetricTile.tsx`
- **⚠️ 前端全量重写 (Phase 1 开启)**: 彻底移除了对 Ant Design 的强依赖，并在 `frontend` 安装了 headless UI 基础库 (`@radix-ui`, `framer-motion`, `class-variance-authority`)。
- **重置设计系统基建**: 重写了 `tailwind.config.js` 和 `src/styles.css`，注入了一套极致的无极色彩系统与空间原子类。
- **沉淀原生组件**: 在 `src/components/ui/` 下建立了底层原子组件 `Button` 和 `Card`，引入物理悬浮反馈（Spring Physics）。
- **🔥 App Shell 涅槃 (Phase 2 完成)**: 彻底清空了旧的 `App.tsx` 中的 Antd 布局外壳。利用纯粹的 Tailwind Flexbox 与 `framer-motion` 的 `<AnimatePresence>` 编写了全新的“无边框”侧边栏（Sidebar）与页面路由转场引擎。同时，移除了 `main.tsx` 中的 antd css 引用。
- **🚀 核心页面破冰 (Phase 3 完成)**: `GovernancePage.tsx`, `RepairTasksPage.tsx`, `SkillApprovalDrawer.tsx`, `TaskCreateWizard.tsx`, `TaskOperationsDrawer.tsx`, `TaskSnapshotPanel.tsx` 及其余相关页面已完成全量代码重写。移除了全部的 Antd 引入，取而代之的是纯粹的 Tailwind Grid/Flexbox 布局。使用了原生的 HTML 元素构建，并采用 `lucide-react` 替换了所有旧图标。
- **🎨 WorkflowDesigner 全量重构 (Phase 4 完成)**: `WorkflowDesignerPage.tsx` 以及其子组件现已完全重写并移除了 `antd` 及 `@ant-design/icons` 的依赖，转而使用 `lucide-react` 和纯 Tailwind CSS 原生结构。
- **✨ UI质感与高级动画升级 (Phase 5 完成)**: 
  - 通过 `src/components/AntdShims.tsx` 垫片策略实现了 `antd` 的 100% 清退。
- **🐞 类型与规范修复 (Phase 6 完成)**:
  - 修复了因为移除 antd 带来的所有 TypeScript Error，`npm run typecheck` 实现全量 0 Error 通过。
- **💎 深度美学与物理引擎注入 (Phase 7 完成)**:
  - **字体与调色盘进化**: 移除了默认的“AI蓝紫色”渐变，换成了极具高级感的白/Zinc系 Mesh Gradient，并引入全局 `Geist` 字体集。
  - **液态玻璃 (Liquid Glass)**: 给底层 `Card`、`MetricTile` 以及 `OverviewPage` 的内嵌面板全面应用了毛玻璃材质（带有内阴影倒角与 1px 反光边框），剔除了老旧的生硬边框。
  - **弹簧微交互 (Spring Physics)**: 对核心原子组件（`Button`、`Card`、悬浮块）全量配置了 Framer Motion 的弹簧引擎，拥有丝滑的 `:active` 按下反馈。
  - **瀑布流与生命感 (Perpetual Animations)**: 在数据列表加载时加入交错瀑布流（Staggered Reveal），在状态灯点处植入了极其轻量的无限平移反光（Infinite Shimmer），让整个 Dashboard “活”了起来。
  - **Empty States**: 将 `AntdShims` 里的 `Empty` 重写为现代美术馆级别的留白画廊风。

## 当前验证命令：
  - `npm run dev -- --force`
- 测试结果：
  - Vite 已硬重启，环境彻底纯净。
- 下一步：
  - 可以向用户进行最后演示。

## 当前验证命令：
  - `npm run typecheck`
- 测试结果：
  - Typecheck 通过。DAG 具备强烈的工业级科技感与层级感。
- 下一步：
  - 可以向用户进行最后演示。

### 2026-06-16 前端全局样式与 Workflow DAG 画布质感优化

- 改动摘要：全面升级 AegisQA 前端的视觉规范，提升整体“高级感”与排版的合理性。通过修改 Ant Design 的 ConfigProvider 调整品牌色、圆角大小和阴影深度；重构了 WorkflowDesigner 的 DAG 画布，引入了玻璃拟物化(Glassmorphism)的悬浮面板、重绘了发光效果的 CustomNode 以及加入了 SVG 数据流光效的 AnimatedEdge，使整个交互过程更加流畅、现代、并具备科技感。
- 变更文件：
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `frontend/src/pages/workflowDesigner/CustomEdges/AnimatedEdge.tsx`
  - `frontend/src/pages/workflowDesigner/WorkflowCanvasPanel.tsx`
- 验证命令：
  - `npm run typecheck` （已通过）
  - 本地 Vite 开发服务器启动查看效果。
- 测试结果：
  - `npm run typecheck` 成功无报错。
  - React Flow 画布各项交互及动画展示正常，页面结构完整。
- 下一步：
  - 前端 UI 规范统一后，持续推进其他各个二级子页面的排版细节微调。

### 2026-06-05 收尾独立审计与后续建议

- 改动摘要：在“第二轮修复后轻量复扫”之后，再用独立角度复查诊断动作覆盖、生产 demo 兜底、固定 actor 和空白格式，作为连续第二轮无 P0/P1 的收尾证据。
- 变更文件：
  - `docs/PROJECT_STATUS.md`
- 验证命令：
  - PowerShell 比对 `aegisqa/reports/diagnostics.py` 实际产出的诊断动作集合与 `frontend/src/pages/ReportsPage.tsx` 前端处理集合。
  - `rg -n "from ['\"]\\.\\./data/demo|from ['\"]\\.\\./\\.\\./data/demo|demoSkills|demoWorkflowGraph|demoTask|demoBadcase" frontend\src -S -g "!**/*.test.*" -g "!**/test/**"`
  - `rg -n -e 'actor\s*=\s*"api"' -e "actor\s*=\s*'api'" -e '"actor"\s*:\s*"api"' -e "'actor'\s*:\s*'api'" aegisqa\api aegisqa\security aegisqa\engine aegisqa\skills -g "*.py"`
  - `git diff --check`
- 测试结果：
  - 诊断动作覆盖：`diagnostics` 与 `frontend` 均包含 `audit_judge_profile`、`create_segment_ci_gate`、`fix_dataset_fields`、`open_dataset_lineage`、`open_parameter_governance`、`open_trace_flow`、`plan_workflow_parameter_changes`、`retry_failed_items`、`review_badcases`、`seed_annotation_queue`，`missing=none`。
  - 生产前端 demo 兜底复扫：无命中。
  - 生产后端固定 `actor="api"` 复扫：无命中。
  - `git diff --check`：通过，仅有 Windows LF/CRLF 提示。
- 当前结论：
  - 连续两轮修复后轻量审计均未发现新的 P0/P1 可执行优化项。
  - 后端 `python -m pytest -q` 通过；前端 `npm run typecheck`、`npm test`、`npm run build`、`npm run e2e` 均通过。
  - 本轮未启动真实 Docker/MySQL/Redis/Celery 服务；MySQL/Redis/Celery 仍以契约测试、fake adapter 和代码路径验证为主，真实生产部署前建议单独做容器化冒烟。
- 后续低优先级建议：
  - P2：将报告中心诊断动作和修复任务动作的动作定义抽成共享常量，减少前后端字符串漂移风险。
  - P2：为 Docker Compose 的 MySQL/Redis/Celery 增加本地一键 smoke 脚本和 GitHub Actions 可选矩阵。
  - P2：继续拆分超长历史状态文档，保留首页摘要，把历史批次迁移到归档文件，提升阅读效率。
- 下一步：
  - 若需要继续开发，建议先进入真实容器环境冒烟或提交当前工作树；当前“小团队长期试用”的核心高优先级缺口已收敛到可收尾状态。


### 2026-06-01 ~ 2026-06-05 改动汇总

- **权限与审计归因**：连续完成 20+ 个 P0/P1 修复，覆盖 Task、Run、Workflow、Repair Task、Annotation Queue、Candidate Assets、Red Team、Experiment、CI Gate、Dataset、Judge、Skill 生命周期、模型网关、报告导出审批流等全部业务域的真实 actor/role 记录。
- **安全加固**：CSV 导出公式注入防护（`=+-@` 前缀转义）、HTML 导出 XSS 转义、模型网关 API Key 脱敏、Skill 子进程 stdout 体积限制与路径脱敏。
- **并发稳定性**：JsonStore 文件锁、SQLiteStore `BEGIN IMMEDIATE` 串行化、MySQLStore named lock 一致性、WorkflowRunner 批量快照保存。
- **前端性能**：React.lazy 页面级懒加载、ECharts 组件级懒加载、Vite manualChunks 5 拆分、11+ 列表视图服务端分页、报告中心任务远程搜索。
- **治理体验**：模型配置下拉化、Provider 自动迁移、Dashboard/Run 列表轻量化、RunReport 单次遍历聚合。
- **Workflow 画布**：图模型抽离、撤销/重做、节点工具栏、键盘删除、Inspector 字段映射、Skill 参数表单、发布前质量门禁、Skill 参数静态校验。
- **Task 深度**：Task Preflight 创建门禁、执行参数模板、Skill 参数覆盖、表达式路径候选、Preflight 证据持久化、Task Report 结构化与导出。
- 详细改动记录见 [`docs/archive/PROJECT_STATUS_HISTORY.md`](archive/PROJECT_STATUS_HISTORY.md)。

## 当前已完成

- 后端 MVP 与 PRD P0/P1 功能已全部实现；后端测试 100% 通过。
- React 前端 133 tests / 12 files；Playwright E2E 14 passed 覆盖主流程。
- Skill 市场支持 zip 插件包上传、合约测试、审批流程；Agent Skill 支持 script 和 instruction_model 模式。
- Task 一等模型已建立；Task Preflight 已升级为创建门禁；执行参数模板已接入。
- Workflow 画布支持撤销/重做、发布前校验、Skill 参数门禁。
- 报告中心支持质量决策、诊断根因、分层分析、Badcase 纠错、导出审批流。
- Repair Task / Experiment / CI Gate / Annotation Queue / Candidate Assets 均有最小闭环。
- RBAC 五角色 + 20+ 权限类型 + 全业务域审计归因。
- SQLite / JSON Store / MySQL 三种存储后端已接入；并发一致性已优化。

## 当前问题

- Workflow 画布的 Source/Skill/Join/Output/Aggregator 新增、创建连线、删除节点、删除下游连线、删除后重连、节点工具栏、键盘删除、撤销/重做、保存草稿回放、试运行、校验和发布已进入 Playwright；草稿加载覆盖编辑的竞态已修复。后续需要继续拆分 Palette/Inspector 组件，降低单文件维护成本。
- Task 已成为前端主线，完整端到端 UI 流程已由 Playwright 覆盖；Run Attempt、CI Gate、Experiment baseline/A-B 对比和任务报告均已接入基础闭环。
- Skill 插件包已采用受控子进程执行，默认 5 秒超时已覆盖并发 E2E；后续还需补资源限额、依赖隔离、签名校验和更完整的审批页。
- Experiment 快照、CI Gate、Annotation Queue 和 Trace Tree 已有独立产品页；跨任务 Score Analytics 和成本预算状态已接入报告中心，后续需要继续补真实成本账单、更多趋势筛选维度和跨任务对比可视化。
- 报告、Badcase、Judge 审计和 Repair Task 已经接入基础数据与动作，人工审阅队列、多 Judge 一致性、红队扫描、Judge 偏差趋势、修复任务状态流转、Annotation Queue 发起、CI Gate 复测、修复后复跑对比、上下文修复建议、二级修复任务、修复树进度、负责人指派、逾期提醒、Dataset 字段修复计划、Workflow 参数 diff/回滚计划、Prompt/Skill 版本对比、候选资产沉淀、候选资产审批、候选资产批量指派、负责人工作量、负责人容量限制、逾期升级、批量审批、复跑优先级计划、真实批量复跑执行、Workflow 草稿创建、候选草稿发布后自动复跑、三方指标对比、晋升建议、晋升审批、baseline 替换建议、baseline 应用/回滚、baseline 影响分析、baseline 变更提醒、回滚前 CI Gate 复测和 CI Gate 发布记录已有最小闭环；后续需要把外部审批流集成、容量阈值配置化和自动归档策略继续接起来。
- SQLite 轻量仓储已接入元数据路径；后续如果要进入多用户生产环境，仍需要正式 Repository 层、数据库迁移、索引治理、权限隔离和 Worker 队列接入。
- 本地服务曾出现旧 FastAPI 进程未重启导致新增路由 404 的问题；已重启后端并完成浏览器复测。后续修改后端 API 时必须确认 8000 端口加载的是最新代码。

## 下一阶段目标

- Repair Task 深水区：继续把 baseline 变更提醒接入外部审批/IM 通知；候选资产后续可增加容量阈值配置化、自动归档策略和批量复跑并发控制。
- 红队规则配置化：把当前内置规则升级为可管理规则集，支持按业务线启用、禁用、阈值和严重级别调整。
- 成本治理生产化：接入真实 token/cost 账单、模型价格表、预算门禁和成本异常告警。
- 趋势分析增强：为 Score Analytics 增加 Dataset、Workflow、模型版本、Prompt 版本、时间窗口和标签过滤，并补趋势可视化对比。
- Judge 偏差归因：按业务标签、样本类型、模型版本和时间窗口拆解 Accuracy/Kappa 退化原因。
- Repository/Worker 生产化：在 SQLite 轻量模式之上继续推进 Repository 接口抽象、迁移脚本、索引策略、真实 Worker 队列和未来 MySQL/PostgreSQL 适配。


---

## 历史归档

详细改动记录已归档至 [`docs/archive/PROJECT_STATUS_HISTORY.md`](archive/PROJECT_STATUS_HISTORY.md)，包含 2026-05-30 至 2026-06-05 的全部批次改动。
