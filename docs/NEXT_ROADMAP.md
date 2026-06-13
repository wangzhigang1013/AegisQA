# AegisQA 后续优化计划

> 基于当前已完成的工作，下一阶段聚焦于「让平台真正可用」。

---

## 当前完成状态

| 模块 | 状态 | 说明 |
|------|------|------|
| Skill 导出/导入 | ✅ 完成 | 标准 zip 格式，支持批量操作 |
| Anthropic 模型 | ✅ 完成 | Claude 全系列支持 |
| SQLite 存储 | ✅ 完成 | 新增 delete/count/list 方法 |
| DAG 并行执行 | ✅ 完成 | 自动检测 graph 结构并行执行 |
| Python SDK | ✅ 完成 | 完整的 REST API 封装 |
| 前端 UI 优化 | ✅ 完成 | 设计 Token + 深色侧边栏 + 动效 |
| 容器运行时 | ✅ 完成 | Docker 隔离执行 |

---

## 阶段一：模型网关增强（1-2 周）

> 让模型调用更稳定、更经济。

### 1.1 Streaming 支持
- **目标**：长文本生成实时展示
- **改动**：
  - `ModelGateway.generate()` 增加 `stream=True` 参数
  - 返回 `Generator[str, None, None]` 迭代器
  - OpenAI-compatible 和 Anthropic provider 均支持 SSE 流式解析
  - 前端报告页增加「实时生成」面板

### 1.2 模型 Fallback 链
- **目标**：主模型失败时自动切换备选
- **改动**：
  - `ModelGatewayConfig` 增加 `fallback_models: list[str]` 字段
  - `generate()` 失败时按顺序尝试 fallback
  - 记录实际使用的模型到 metrics

### 1.3 多 API Key 轮询
- **目标**：突破单 Key 速率限制
- **改动**：
  - `ModelGatewayConfig.api_keys: list[str]` 支持多 Key
  - 轮询策略：round-robin / least-recently-used
  - 单 Key 429 时自动切换

### 1.4 成本预算门禁
- **目标**：防止意外超支
- **改动**：
  - 任务创建时设置 `cost_budget_usd`
  - 执行过程中累计成本，超预算自动暂停
  - 报告中心展示成本明细（按模型/步骤拆分）

---

## 阶段二：评测能力深化（2-3 周）

> 从「能跑」升级到「评得准」。

### 2.1 自定义评测指标
- **目标**：支持业务自定义的评分维度
- **改动**：
  - `skill.yaml` 新增 `metrics` 字段定义输出指标
  - 支持连续分数（0-1）、分类标签、多维度评分
  - 指标权重配置（用于综合评分）
  - 报告中心按指标维度展示分布

### 2.2 评测模板库扩展
- **目标**：覆盖常见评测场景
- **新增模板**：
  - **RAG 评测**：faithfulness / relevance / context_recall / answer_correctness
  - **Agent 评测**：tool_use_accuracy / planning_efficiency / reflection_quality
  - **多轮对话**：context_retention / topic_coherence / response_consistency
  - **安全评测**：prompt_injection / jailbreak / pii_leakage / harmful_content

### 2.3 A/B 测试统计增强
- **目标**：科学对比不同配置
- **改动**：
  - 新增 `POST /experiments/{id}/statistical-test`
  - 支持 t-test（连续指标）和 chi-squared（分类指标）
  - 计算 p-value 和置信区间
  - 前端展示统计显著性标签

### 2.4 评测基准（Benchmark）管理
- **目标**：标准化评测流程
- **改动**：
  - 新增 `/benchmarks` 端点管理基准数据集
  - 预置常见基准：MMLU / HumanEval / GSM8K
  - 基准跑分排行榜
  - 基准版本管理

---

## 阶段三：Workflow 引擎增强（2-3 周）

> 支持更复杂的评测编排。

### 3.1 条件分支增强
- **目标**：支持更复杂的条件逻辑
- **改动**：
  - 条件表达式支持比较运算：`score >= 0.8`
  - 支持正则匹配：`output matches "pattern"`
  - 支持逻辑组合：`score >= 0.8 AND latency < 1000`
  - 前端画布条件配置 UI

### 3.2 循环节点
- **目标**：对列表字段迭代执行
- **改动**：
  - 新增 `loop` 节点类型
  - 配置：`items_path`（数据源）、`item_alias`（迭代变量）
  - 子步骤在每次迭代中执行
  - 聚合结果输出

### 3.3 子工作流
- **目标**：Workflow 嵌套复用
- **改动**：
  - 新增 `subworkflow` 节点类型
  - 引用已发布的 Workflow 版本
  - 输入/输出映射
  - 执行追踪合并

### 3.4 执行缓存增强
- **目标**：提升重复执行效率
- **改动**：
  - 缓存命中率统计 API
  - 缓存失效策略（时间窗口 / 手动）
  - 跨任务缓存共享配置
  - 前端缓存状态展示

---

## 阶段四：平台工程化（3-4 周）

> 从 demo 级升级到可部署。

### 4.1 认证系统
- **目标**：多用户安全访问
- **改动**：
  - JWT Token 认证
  - 登录/注册端点
  - API Key 管理（用于 CI/CD）
  - 前端登录页面

### 4.2 PostgreSQL 适配器
- **目标**：生产级存储
- **改动**：
  - 新增 `aegisqa/storage/pg_store.py`
  - 使用 SQLAlchemy ORM
  - 数据库迁移脚本（Alembic）
  - 连接池配置

### 4.3 Docker Compose 一键部署
- **目标**：开箱即用
- **改动**：
  - 完善 `docker-compose.yml`（FastAPI + React + MySQL + Redis + Celery）
  - 环境变量配置模板
  - 初始化脚本
  - 健康检查

### 4.4 GitHub Actions CI/CD
- **目标**：自动化质量门禁
- **改动**：
  - `.github/workflows/ci.yml`（后端测试 + 前端测试 + E2E）
  - `.github/workflows/deploy.yml`（Docker 构建 + 推送）
  - PR 评论集成评测报告

---

## 阶段五：开发者体验（2-3 周）

> 降低使用门槛。

### 5.1 CLI 工具
- **目标**：命令行操作平台
- **改动**：
  - `aegisqa skill upload <zip>` — 上传 Skill
  - `aegisqa skill export <id> -o <path>` — 导出 Skill
  - `aegisqa workflow run <id> --dataset <id>` — 执行任务
  - `aegisqa report <task-id>` — 查看报告

### 5.2 交互式教程
- **目标**：新用户快速上手
- **改动**：
  - 首页引导流程（Step-by-Step）
  - 示例数据集 + 示例 Workflow 预置
  - 一键体验按钮

### 5.3 API 文档增强
- **目标**：开发者友好
- **改动**：
  - OpenAPI 3.0 规范完善
  - 请求/响应示例
  - 错误码文档
  - SDK 使用指南

---

## 优先级排序

| 阶段 | 优先级 | 预计周期 | 核心价值 |
|------|--------|----------|----------|
| 阶段一：模型网关增强 | 🔴 P0 | 1-2 周 | 稳定性和成本控制 |
| 阶段二：评测能力深化 | 🔴 P0 | 2-3 周 | 评得准、评得深 |
| 阶段三：Workflow 引擎增强 | 🟡 P1 | 2-3 周 | 复杂编排能力 |
| 阶段四：平台工程化 | 🟡 P1 | 3-4 周 | 生产部署 |
| 阶段五：开发者体验 | 🟠 P2 | 2-3 周 | 降低门槛 |

---

## 立即可做的 Top 5

| # | 任务 | 价值 | 工作量 |
|---|------|------|--------|
| 1 | Streaming 支持 | 长文本实时展示 | 2-3 天 |
| 2 | 模型 Fallback 链 | 提升稳定性 | 1-2 天 |
| 3 | 自定义评测指标 | 业务定制化 | 3-5 天 |
| 4 | 条件分支增强 | 复杂逻辑支持 | 2-3 天 |
| 5 | JWT 认证 | 多用户支持 | 3-5 天 |
