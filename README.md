# AegisQA

**AI 工程治理与自动化评测平台**

[![CI/CD](https://github.com/your-org/AegisQA/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/AegisQA/actions)
[![Python](https://img.shields.io/badge/python-3.10+-blue.svg)](https://python.org)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

AegisQA 是一个面向 AI 测试、评测与研发团队的轻代码自动化评测平台。它的核心目标不是只展示一些静态指标，而是把一次 AI 评测任务完整串起来：

```text
上传或选择数据集
  -> 选择或创建 Workflow
  -> 绑定 Skill 输入、输出和运行参数
  -> 创建 Task
  -> 按数据集逐条执行 Workflow
  -> 查看任务报告、Trace、Badcase
  -> 导出结果、人工纠错、沉淀 Golden Dataset
```

## 核心特性

### 🎯 评测治理
- **完整闭环**：评测数据、流程、任务和报告形成可追溯闭环
- **Skill 插件化**：支持 12 种 Skill 类型，统一适配器模式
- **Workflow DAG**：支持点对点、点对多、多对一、条件分支和聚合节点
- **执行追踪**：每条样本独立执行轨迹，精确定位失败原因

### 🔒 安全与认证
- **JWT 认证**：Access Token + Refresh Token 双令牌机制
- **RBAC 权限**：Admin、Skill Developer、Evaluator、Reviewer、Viewer 角色
- **API 限流**：滑动窗口算法，防止恶意请求
- **安全扫描**：Skill 包上传时自动检测网络外传、Shell 注入、API Key 泄露

### 📊 可观测性
- **Prometheus 指标**：HTTP 请求、模型调用、Token 使用等核心指标
- **结构化日志**：JSON 格式日志，支持 Request-ID 追踪
- **OpenTelemetry**：分布式追踪支持
- **健康检查**：`/healthz` 端点，检查数据库、磁盘、存储状态

### 🌍 国际化
- **多语言支持**：中文/英文界面切换
- **i18n 框架**：基于 react-i18next 的完整翻译方案

### 🚀 生产就绪
- **Docker 支持**：多阶段构建，非 root 用户运行
- **CI/CD**：GitHub Actions 自动化测试和部署
- **连接池**：MySQL 连接池管理
- **Redis 缓存**：可选的 Redis 缓存层

---

## 技术栈

### 后端
- **FastAPI**：高性能异步 Web 框架
- **Pydantic v2**：数据验证和序列化
- **JWT**：python-jose + passlib 实现认证
- **Prometheus**：指标收集和暴露
- **存储后端**：JSON / SQLite / MySQL 可选
- **Pytest**：单元测试、API 合约测试

### 前端
- **React 18**：用户界面框架
- **TypeScript**：类型安全
- **Ant Design 5**：企业级 UI 组件
- **React Flow**：Workflow 画布
- **TanStack Query**：数据获取和缓存
- **i18next**：国际化框架
- **Vitest**：单元测试

---

## 快速开始

### 1. 环境准备

```bash
# 克隆仓库
git clone https://github.com/your-org/AegisQA.git
cd AegisQA

# 安装后端依赖
pip install -r requirements.txt

# 安装前端依赖
cd frontend
npm install
cd ..
```

### 2. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，配置以下关键项：
# - AEGISQA_MODEL_API_KEY: 模型 API Key
# - AEGISQA_JWT_SECRET: JWT 签名密钥
# - AEGISQA_STORAGE_BACKEND: 存储后端 (json/sqlite/mysql)
```

### 3. 启动服务

```bash
# 启动后端 (默认端口 8000)
python -m uvicorn aegisqa.api.app:app --reload --host 127.0.0.1 --port 8000

# 新终端，启动前端 (默认端口 5173)
cd frontend
npm run dev
```

### 4. 访问系统

- **前端工作台**: http://localhost:5173
- **API 文档**: http://localhost:8000/docs
- **健康检查**: http://localhost:8000/healthz
- **指标端点**: http://localhost:8000/metrics

### 5. 默认账号

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | admin123 | Admin |
| evaluator | evaluator123 | Evaluator |
| viewer | viewer123 | Viewer |

---

## Skill 类型支持

AegisQA 支持 12 种 Skill 类型，通过自动检测和适配器模式统一管理：

| 类型 | 说明 | 执行方式 |
|------|------|----------|
| **aegisqa_native** | 原生 AegisQA Skill | Subprocess |
| **python_function** | 裸 Python 函数 | 适配器包装 |
| **openai_tool** | OpenAI Function Calling | 适配器包装 |
| **instruction** | 纯指令型 (SKILL.md) | 模型网关 |
| **langchain** | LangChain Chain/Agent | 适配器包装 |
| **llamaindex** | LlamaIndex QueryEngine | 适配器包装 |
| **rest_api** | HTTP REST API | HTTP 调用 |
| **huggingface** | HuggingFace Pipeline | 适配器包装 |
| **langgraph** | LangGraph Agent/Graph | 适配器包装 |
| **container** | Docker 容器化 Skill | 容器执行 |
| **grpc** | gRPC Service | (检测支持) |
| **semantic_kernel** | Semantic Kernel Plugin | (检测支持) |

### Skill 类型详解

#### 1. 纯代码型 (Code Only)
```yaml
# skill.yaml
skill_id: plugin.my_skill@1.0.0
runtime:
  language: python
  entrypoint: handler.py
```

```python
# handler.py
def run(inputs, config):
    return {"result": "processed"}
```

#### 2. 纯指令型 (Instruction Only)
```markdown
<!-- SKILL.md -->
---
name: translation_assistant
description: 中英文翻译助手
---

# 翻译助手
请根据输入文本自动检测语言并翻译...
```

#### 3. 代码+提示词混合型 (Code + Prompt)
```python
# handler.py
def run(inputs, config):
    text = inputs["text"]
    prompt = config["prompt_template"].format(text=text)
    # 代码处理 + 提示词调用
    return {"analysis": result}
```

#### 4. 多提示词类型 (Multi-Prompt)
```python
# handler.py
def run(inputs, config):
    # 多个 prompt 模板
    sentiment = analyze_with_prompt(config["sentiment_prompt"])
    keywords = analyze_with_prompt(config["keyword_prompt"])
    summary = analyze_with_prompt(config["summary_prompt"])
    return {"sentiment": sentiment, "keywords": keywords, "summary": summary}
```

---

## 目录结构

```text
AegisQA/
├── aegisqa/                    # 后端核心代码
│   ├── api/                    # FastAPI app 与路由
│   │   ├── app.py              # 应用入口和配置
│   │   └── routes/             # API 路由模块
│   │       ├── auth.py         # 认证接口
│   │       ├── skills.py       # Skill 管理
│   │       ├── datasets.py     # 数据集管理
│   │       ├── workflows.py    # Workflow 管理
│   │       ├── tasks.py        # 任务管理
│   │       └── ...
│   ├── security/               # 安全模块
│   │   ├── auth.py             # JWT 认证
│   │   ├── middleware.py       # 认证中间件
│   │   └── rate_limit.py       # 限流中间件
│   ├── observability/          # 可观测性
│   │   ├── metrics.py          # Prometheus 指标
│   │   ├── logging_config.py   # 结构化日志
│   │   └── tracing.py          # 分布式追踪
│   ├── skills/                 # Skill 系统
│   │   ├── base.py             # Skill 基类
│   │   ├── registry.py         # Skill 注册表
│   │   ├── detector.py         # 类型自动检测
│   │   ├── adapters/           # 类型适配器
│   │   │   ├── base.py         # 适配器基类
│   │   │   ├── python_function.py
│   │   │   ├── openai_tool.py
│   │   │   ├── langchain_adapter.py
│   │   │   └── ...
│   │   ├── packages.py         # 包执行器
│   │   └── universal_runner.py # 统一运行器
│   ├── engine/                 # 执行引擎
│   │   ├── runner.py           # Workflow 执行器
│   │   └── redis_cache.py      # Redis 缓存
│   ├── storage/                # 存储层
│   │   ├── json_store.py       # JSON 文件存储
│   │   ├── sqlite_store.py     # SQLite 存储
│   │   ├── mysql_store.py      # MySQL 存储
│   │   └── file_lock.py        # 文件锁
│   ├── workflows/              # Workflow 系统
│   ├── reports/                # 报告系统
│   ├── badcases/               # Badcase 管理
│   ├── judge/                  # Judge 审计
│   ├── audit/                  # 审计日志
│   ├── models/                 # 模型网关
│   └── workers/                # Celery Worker
├── frontend/                   # React 前端
│   ├── src/
│   │   ├── api/                # API 客户端
│   │   ├── components/         # 通用组件
│   │   │   ├── ErrorBoundary.tsx
│   │   │   └── ChunkErrorBoundary.tsx
│   │   ├── pages/              # 页面组件
│   │   ├── i18n/               # 国际化
│   │   │   ├── index.ts
│   │   │   └── locales/
│   │   │       ├── zh.json
│   │   │       └── en.json
│   │   └── App.tsx
│   └── package.json
├── tests/                      # 后端测试
├── scripts/                    # 测试脚本
├── docs/                       # 文档
├── examples/                   # 示例
├── infra/                      # 基础设施
├── Dockerfile                  # Docker 构建
├── .github/workflows/ci.yml   # CI/CD 配置
├── .env.example                # 环境变量模板
└── docker-compose.yml          # Docker Compose
```

---

## API 概览

### 认证接口
```text
POST /auth/login          # 登录获取 Token
POST /auth/refresh        # 刷新 Token
GET  /auth/me             # 获取当前用户信息
```

### Skill 管理
```text
GET    /skills                    # 列出所有 Skill
POST   /skills/packages/upload    # 上传 Skill 包
POST   /skills/{id}/contract-test # 合约测试
POST   /skills/{id}/approve       # 审批启用
POST   /skills/{id}/disable       # 禁用
```

### 数据集管理
```text
GET    /datasets                  # 列出数据集
POST   /datasets/upload           # 上传 CSV/JSONL
POST   /datasets/source-materialize # 创建数据集
GET    /datasets/{id}/versions    # 版本列表
```

### Workflow 管理
```text
GET    /workflows                 # 列出 Workflow
POST   /workflow-drafts           # 创建草稿
POST   /workflow-drafts/{id}/publish # 发布版本
DELETE /workflow-drafts/{id}      # 删除草稿
```

### 任务管理
```text
GET    /tasks                     # 列出任务
POST   /tasks                     # 创建任务
POST   /tasks/{id}/execute        # 执行任务
POST   /tasks/{id}/pause          # 暂停任务
POST   /tasks/{id}/resume         # 恢复任务
POST   /tasks/{id}/cancel         # 取消任务
POST   /tasks/{id}/retry-failed   # 重试失败项
```

### 报告与分析
```text
GET    /tasks/{id}/report         # 任务报告
GET    /tasks/{id}/trace-tree     # 执行追踪
GET    /badcases                  # Badcase 列表
GET    /audit-events              # 审计日志
```

### 模型网关
```text
GET    /model-gateway/config      # 获取配置
PUT    /model-gateway/config      # 更新配置
GET    /model-gateway/status      # 网关状态
POST   /model-gateway/test        # 测试连接
```

### 系统监控
```text
GET    /health                    # 简单健康检查
GET    /healthz                   # 详细健康检查
GET    /metrics                   # Prometheus 指标
GET    /metrics/summary           # 指标摘要
```

---

## 配置说明

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `AEGISQA_STORE_ROOT` | 数据存储根目录 | `data/aegisqa_store` |
| `AEGISQA_STORAGE_BACKEND` | 存储后端 | `json` |
| `AEGISQA_MODEL_PROVIDER` | 模型提供商 | `mock` |
| `AEGISQA_MODEL_BASE_URL` | 模型 API 地址 | - |
| `AEGISQA_MODEL_API_KEY` | 模型 API Key | - |
| `AEGISQA_MODEL_DEFAULT_MODEL` | 默认模型名 | `mock-eval-model` |
| `AEGISQA_JWT_SECRET` | JWT 签名密钥 | `aegisqa-dev-secret-change-in-production` |
| `AEGISQA_RATE_LIMIT_ENABLED` | 启用限流 | `false` |
| `AEGISQA_RATE_LIMIT_REQUESTS` | 限流请求数 | `100` |
| `AEGISQA_RATE_LIMIT_WINDOW` | 限流窗口(秒) | `60` |
| `AEGISQA_CORS_ORIGINS` | CORS 允许源 | `http://localhost:5173` |
| `AEGISQA_CACHE_TTL` | 缓存 TTL(秒) | `3600` |

### 模型网关配置

支持的模型提供商：
- `mock` / `demo` / `offline`：离线模拟模式
- `openai` / `openai_compatible`：OpenAI 兼容接口
- `anthropic` / `claude`：Anthropic Claude 接口

---

## 测试

### 后端测试

```bash
# 运行所有测试
python -m pytest -q

# 运行特定测试
python -m pytest tests/test_stability_hardening.py -v

# 运行 Skill 类型测试
python scripts/test_all_skill_types.py
```

### 前端测试

```bash
cd frontend

# 类型检查
npm run typecheck

# 单元测试
npm test

# 生产构建
npm run build

# 端到端测试
npm run e2e
```

---

## 部署

### Docker 部署

```bash
# 构建镜像
docker build -t aegisqa .

# 运行容器
docker run -p 8000:8000 -p 5173:5173 aegisqa
```

### Docker Compose

```bash
# 启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f
```

详细部署说明请参考 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

---

## 文档

- [部署指南](docs/DEPLOYMENT.md)
- [Skill 类型测试报告](docs/SKILL_TYPES_TEST_REPORT.md)
- [Agent Skill 打包指南](docs/AGENT_SKILL_PACKAGE_GUIDE.md)
- [项目状态](docs/PROJECT_STATUS.md)

---

## 贡献指南

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

---

## 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

---

## 致谢

感谢所有为 AegisQA 做出贡献的开发者！
