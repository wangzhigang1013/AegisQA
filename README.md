# AegisQA

AegisQA 是一个面向 AI 测试与研发团队的轻代码评测工作流平台 MVP。

当前实现目标来自 `AI_Automation_Eval_Workflow_PRD_final(1).md`：

- Python Skill 注册与合约校验
- CSV/JSONL 数据集流式解析与版本化
- 线性 Workflow 编排与类型安全字段映射
- Run / Run Item / Step 级执行轨迹
- 报告聚合、Badcase 人工纠错、Golden/Judge 审计
- Secret 脱敏与可追溯运行快照
- React 前端工作台：数据集、Skill 市场、Workflow 设计器、执行、报告、Judge、治理

## 前后端分离启动

后端使用 FastAPI，前端使用 React/Vite/TypeScript。Streamlit 仍保留为 legacy demo，不再作为产品化主前端扩展。

启动后端 API：

```powershell
python -m uvicorn aegisqa.api.app:app --reload --host 127.0.0.1 --port 8000
```

启动前端：

```powershell
cd frontend
npm install
npm run dev
```

前端默认访问：

```text
http://localhost:5173
```

Vite 会把 `/api/*` 代理到 `http://127.0.0.1:8000`。

## 存储与生产化边界

当前默认 `JsonStore` 是本地 demo 存储，适合单机开发、自动化验收和面试演示。它已经增加文件锁与原子写入：

- JSON 写入会先写临时文件，再用 `os.replace` 原子替换，避免读取到半截 JSON。
- JSONL 追加与读写会通过 `.lock` 文件串行化，降低 Playwright、后端测试或本地多进程同时写入时的数据损坏风险。
- 锁文件只解决本地文件并发保护，不提供事务、索引、权限隔离、分布式一致性或高可用能力。

生产部署不要继续使用 JSON Store 作为主数据库。生产建议：

- 元数据与任务状态：MySQL/PostgreSQL，使用事务保证 Task、Run、Report、Badcase 状态一致。
- 执行队列：Redis + Celery，队列消息只携带轻量 `item_id`，Worker 从数据库加载完整上下文。
- 大文件与报告产物：对象存储或受控文件服务，数据库只保存版本、路径、hash 和审计元数据。
- Secret 与插件包：接入密钥管理和签名校验，插件运行进入隔离执行环境。

## 验证命令

后端测试：

```powershell
python -m pytest -q
```

运行 1000 条样本端到端演示：

```powershell
python -m aegisqa.examples.run_mvp_demo
```

前端验证：

```powershell
cd frontend
npm run typecheck
npm test
npm run build
```

Legacy Streamlit demo：

```powershell
streamlit run streamlit_app.py
```

## 新前端页面

- 概览：最近 Run 状态、关键指标和“开始一次评测”入口。
- 数据集：CSV/JSONL 上传、Source Skill 物化、字段路径预览、类型修正入口。
- Skill 市场：Skill manifest、schema、权限、缓存标记和合约测试入口。
- Workflow 设计器：React Flow 画布、Skill Palette、节点 Inspector、校验与试运行 Console。
- 执行中心：Run 控制、Run Item、Step Trace、暂停/恢复/取消/重试失败项。
- 报告中心：指标卡、耗时分布、Badcase 列表、导出入口。
- Judge 审计：Profile 审计指标、混淆矩阵、错判样本和偏差分析。
- 治理与审计：RBAC、Skill 生命周期、审计日志和生产适配状态。

## Workflow 图设计规则

- 点对点：`DatasetSource -> LLMCall -> LLMJudge -> Report`。
- 点对多：一个上游输出可同时连接多个下游，例如 `LLMCall -> RuleCheck / LLMJudge / HallucinationCheck`。
- 多对一：多个上游必须显式进入 `Join` 或 `Aggregator`，避免隐式覆盖 `context`。
- 条件分支：`Branch` 节点或连线必须配置条件表达式。
- 发布前校验：DAG 无环、Skill 可引用、字段映射类型匹配、Join/Aggregator 结构安全。

生产适配资产：

- `docker-compose.yml`：MySQL 8.0、Redis、Celery Worker 参考编排。
- `infra/mysql/schema.sql`：PRD 核心实体的 MySQL 表结构。
- `infra/celery/README.md`：轻量 `item_id` 消息契约和限速策略。
- `aegisqa/infrastructure/manifest.py`：生产就绪适配清单。
