# AegisQA 最终优化计划

> 基于已完成的所有工作，聚焦于「让平台完整可用」。

---

## 已完成清单

| 模块 | 状态 | 说明 |
|------|------|------|
| Skill 导出/导入 | ✅ | 标准 zip 格式，批量操作 |
| Anthropic 模型 | ✅ | Claude 全系列 |
| SQLite 存储 | ✅ | 完整 CRUD |
| DAG 并行执行 | ✅ | 自动检测 graph |
| Python SDK | ✅ | REST API 封装 |
| CLI 工具 | ✅ | 命令行操作 |
| Streaming | ✅ | OpenAI + Anthropic |
| Fallback 链 | ✅ | 自动切换备选模型 |
| 多 API Key | ✅ | 轮询策略 |
| 自定义指标 | ✅ | 连续/分类/二值 |
| 条件分支 | ✅ | 比较/正则/逻辑组合 |
| 循环节点 | ✅ | 列表迭代执行 |
| 前端 UI | ✅ | 设计 Token + 动效 |
| 容器运行时 | ✅ | Docker 隔离 |

---

## 阶段一：评测模板库扩展（1-2 周）

> 覆盖常见评测场景，开箱即用。

### 1.1 RAG 评测模板
- **指标**：faithfulness / relevance / context_recall / answer_correctness
- **Workflow**：Source → LLMCall → LLMJudge（多维度）
- **数据集格式**：question / context / reference / answer

### 1.2 Agent 评测模板
- **指标**：tool_use_accuracy / planning_efficiency / reflection_quality
- **Workflow**：Source → AgentStep → ToolJudge → ReflectionJudge
- **数据集格式**：task / tools / expected_steps / expected_output

### 1.3 多轮对话评测模板
- **指标**：context_retention / topic_coherence / response_consistency
- **Workflow**：Source → MultiTurnLLM → DialogueJudge
- **数据集格式**：conversation_history / expected_response

### 1.4 安全评测模板
- **指标**：prompt_injection_resistance / pii_leakage / harmful_content
- **Workflow**：Source → SafetyScanner → SafetyJudge
- **数据集格式**：prompt / expected_safe / attack_type

---

## 阶段二：A/B 测试增强（1 周）

> 科学对比不同配置。

### 2.1 统计检验 API
- **新增端点**：`POST /experiments/{id}/statistical-test`
- **支持检验**：
  - t-test（连续指标，如 latency、score）
  - chi-squared（分类指标，如 pass/fail）
  - Mann-Whitney U（非参数检验）
- **输出**：p-value、置信区间、效应量、显著性标签

### 2.2 前端统计展示
- 实验对比页增加「统计显著性」列
- p-value < 0.05 标记为「显著」
- 置信区间可视化（误差条）

### 2.3 自动推荐
- 基于统计结果自动推荐最优配置
- 标记「建议采用」的配置

---

## 阶段三：子工作流与缓存增强（1-2 周）

> 复杂编排和性能优化。

### 3.1 子工作流节点
- **新增节点类型**：`subworkflow`
- **配置**：
  - `workflow_version_id`：引用已发布 Workflow
  - `input_mapping`：父 → 子输入映射
  - `output_mapping`：子 → 父输出映射
- **执行**：递归调用 WorkflowRunner

### 3.2 执行缓存增强
- **缓存命中率统计 API**：`GET /runs/{id}/cache-stats`
- **缓存失效策略**：
  - 时间窗口：超过 N 小时自动失效
  - 手动失效：`POST /runs/{id}/cache/invalidate`
- **跨任务缓存共享**：同 Workflow + 同 Dataset 的缓存可复用
- **前端缓存状态**：任务详情展示缓存命中率

---

## 阶段四：交互式教程（1 周）

> 新用户快速上手。

### 4.1 首页引导流程
- 新用户首次访问显示引导弹窗
- 步骤：上传数据 → 选择 Skill → 创建 Workflow → 执行任务 → 查看报告
- 每步高亮对应 UI 区域

### 4.2 示例数据预置
- 内置示例数据集（10 条 QA 样本）
- 内置示例 Workflow（LLMCall → LLMJudge）
- 一键体验按钮

### 4.3 教程文档
- 5 分钟快速入门
- 常见场景指南（RAG 评测、Agent 评测）
- 视频教程链接

---

## 阶段五：API 文档增强（3-5 天）

> 开发者友好。

### 5.1 OpenAPI 规范完善
- 所有端点添加详细描述
- 请求/响应示例
- 错误码文档

### 5.2 SDK 使用指南
- Python SDK 快速入门
- 常见用例代码示例
- 最佳实践

### 5.3 API Explorer
- 交互式 API 测试页面
- 自动生成 curl 命令
- 响应格式化展示

---

## 优先级排序

| 阶段 | 优先级 | 预计周期 | 核心价值 |
|------|--------|----------|----------|
| 阶段一：评测模板库 | 🔴 P0 | 1-2 周 | 开箱即用 |
| 阶段二：A/B 测试增强 | 🔴 P0 | 1 周 | 科学对比 |
| 阶段三：子工作流与缓存 | 🟡 P1 | 1-2 周 | 复杂编排 |
| 阶段四：交互式教程 | 🟡 P1 | 1 周 | 降低门槛 |
| 阶段五：API 文档 | 🟠 P2 | 3-5 天 | 开发者体验 |

---

## 立即可做的 Top 5

| # | 任务 | 价值 | 工作量 |
|---|------|------|--------|
| 1 | RAG 评测模板 | 最常见场景 | 2-3 天 |
| 2 | 统计检验 API | 科学对比 | 2-3 天 |
| 3 | 子工作流节点 | 复杂编排 | 3-5 天 |
| 4 | 首页引导流程 | 新用户体验 | 2-3 天 |
| 5 | OpenAPI 规范 | 开发者友好 | 2-3 天 |
