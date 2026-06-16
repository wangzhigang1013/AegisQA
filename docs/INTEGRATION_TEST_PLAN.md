# AegisQA 前后端联调计划

**生成时间**: 2026-06-16  
**前端**: http://localhost:5173 (Vite + React 18 + TypeScript)  
**后端**: http://localhost:8000 (FastAPI + SQLite)

---

## 一、总体架构

```
前端 (React) ──fetch──> /api/* ──> FastAPI Routes ──> Storage/Engine
     │                                        │
     └── api/client.ts (统一请求层)            └── 172 个 API 端点
         - 自动重试 502/503/504
         - ApiError 统一错误处理
         - Blob 下载支持
```

**前端调用**: 84 个去重端点 (GET 39 + POST 44 + PUT 3 + DELETE 2)  
**后端注册**: 172 个端点 (16 个路由文件)  
**已修复**: `/annotation-queue` 500 错误 (缺少 `now_beijing` 导入)

---

## 二、联调分层策略

### 第 1 层: 健康检查与基础连通性 (5 min)
| 测试项 | 端点 | 预期 | 优先级 |
|--------|------|------|--------|
| 后端健康 | `GET /health` | `{"status":"ok"}` | P0 |
| 前端可达 | `GET http://localhost:5173` | HTML 页面 | P0 |
| 特性开关 | `GET /features` | FeatureFlags 对象 | P1 |
| CORS | 前端跨域请求后端 | 无 CORS 错误 | P0 |

### 第 2 层: 核心数据流 (按页面分组)

#### 2.1 概览页 (OverviewPage)
| 接口 | 方法 | 验证点 |
|------|------|--------|
| `/dashboard/summary` | GET | 返回任务数、Skill 数等统计数据 |
| `/tasks?page=1&page_size=6` | GET | 分页结构 `{items, pagination}` |
| `/skills/packages` | GET | Skill 包列表 |
| `/experiments` | GET | 实验列表 |
| `/annotation-queue` | GET | ✅ 已修复 |
| `/ci-gates` | GET | 质量门禁列表 |

#### 2.2 任务管理 (RunsPage)
| 接口 | 方法 | 验证点 |
|------|------|--------|
| `/tasks?{filters}` | GET | 分页、状态筛选、搜索 |
| `/workflows` | GET | 工作流版本列表 |
| `/datasets` | GET | 数据集列表 |
| `/tasks/{id}` | GET | 单任务详情 |
| `/tasks/preflight` | POST | 预检请求 → 返回预检结果 |
| `/tasks` | POST | 创建任务 → 返回任务记录 |
| `/tasks/{id}/execute` | POST | 执行任务 (background=true) |
| `/tasks/{id}/pause` | POST | 暂停 |
| `/tasks/{id}/resume` | POST | 恢复 |
| `/tasks/{id}/cancel` | POST | 取消 |
| `/tasks/{id}/attempts` | POST | 新增尝试 |
| `/tasks/{id}/retry-failed` | POST | 重试失败项 |

#### 2.3 报告系统 (ReportsPage)
| 接口 | 方法 | 验证点 |
|------|------|--------|
| `/tasks/{id}/report` | GET | 完整报告 (badcase/step/segment 分页) |
| `/score-analytics` | GET | 分数分析数据 |
| `/audit-events` | GET | 审计事件 |
| `/report-export-requests` | GET | 导出请求列表 |
| `/tasks/{id}/report/export` | GET | 报告导出 |
| `/tasks/{id}/report/offline-package` | GET | 离线包下载 (Blob) |
| `/red-team/scans` | POST | 红队扫描 |
| `/badcases/{id}/correct` | POST | 纠错 |
| `/badcases/bulk-correct` | POST | 批量纠错 |
| `/ci-gates/evaluate` | POST | 质量门禁评估 |

#### 2.4 数据管理 (DatasetsPage)
| 接口 | 方法 | 验证点 |
|------|------|--------|
| `/datasets` | GET | 数据集列表 |
| `/datasets/upload` | POST | 文件上传 (base64) |
| `/datasets/source-materialize` | POST | 在线构造数据集 |
| `/datasets/{id}/versions/{v}/lineage` | GET | 血缘关系 |
| `/datasets/{id}/versions/{v}/quality` | GET | 质量诊断 |
| `/datasets/{id}/versions/{v}/repair-version` | POST | 修复版本 |

#### 2.5 Skill 管理 (SkillsPage)
| 接口 | 方法 | 验证点 |
|------|------|--------|
| `/skills` | GET | Skill Manifest 列表 |
| `/skills/packages` | GET | Skill 包列表 |
| `/skills/{id}/versions` | GET | 版本历史 |
| `/skills/packages/upload` | POST | 上传 Skill 包 (base64) |
| `/skills/{id}/contract-test` | POST | 合约测试 |
| `/skills/{id}/rollback` | POST | 版本回滚 |

#### 2.6 工作流设计器 (WorkflowDesignerPage)
| 接口 | 方法 | 验证点 |
|------|------|--------|
| `/skills` | GET | 可用 Skill 列表 |
| `/workflow-templates` | GET | 模板列表 |
| `/workflow-drafts` | GET/POST | 草稿 CRUD |
| `/workflow-drafts/{id}` | GET/PUT/DELETE | 单草稿操作 |
| `/workflow-drafts/{id}/publish` | POST | 发布草稿 |
| `/workflow-graphs/validate` | POST | DAG 校验 |
| `/workflow-graphs/dry-run` | POST | 试运行 |
| `/workflow-graphs/parameter-preview` | POST | 参数预览 |
| `/model-gateway/connections` | GET | 模型连接列表 |
| `/datasets` | GET | 数据集列表 |

#### 2.7 工作流市场 (WorkflowMarketPage)
| 接口 | 方法 | 验证点 |
|------|------|--------|
| `/workflow-drafts?status=...` | GET | 按状态筛选草稿 |
| `/workflows` | GET | 已发布工作流 |
| `/workflow-templates` | GET | 模板 |
| `/workflows/{id}/archive` | POST | 归档 |

#### 2.8 实验管理 (ExperimentsPage)
| 接口 | 方法 | 验证点 |
|------|------|--------|
| `/experiments` | GET | 实验列表 |
| `/runs?page=1&page_size=100` | GET | 运行列表 |
| `/experiments/from-run` | POST | 从运行创建实验快照 |

#### 2.9 质量门禁 (CIGatesPage)
| 接口 | 方法 | 验证点 |
|------|------|--------|
| `/ci-gates` | GET/POST | CRUD |
| `/ci-gates/evaluations` | GET | 评估历史 |
| `/ci-gates/evaluate` | POST | 执行评估 |

#### 2.10 标注队列 (AnnotationQueuePage)
| 接口 | 方法 | 验证点 |
|------|------|--------|
| `/annotation-queue` | GET | ✅ 已修复，列表+分页 |
| `/annotation-candidates` | GET | 候选项 |
| `/annotation-queue/{id}/assign` | POST | 分配 |
| `/annotation-queue/{id}/review` | POST | 审核 |
| `/annotation-queue/bulk-review` | POST | 批量审核 |
| `/annotation-queue/dispatch` | POST | 自动分派 |

#### 2.11 候选资产 (CandidateAssetsPage)
| 接口 | 方法 | 验证点 |
|------|------|--------|
| `/prompt-skill-candidates` | GET | 候选列表 |
| `/prompt-skill-candidates/workload` | GET | 工作负载 |
| `/prompt-skill-candidates/retest-plan` | GET | 重测计划 |
| `/baseline-change-notifications` | GET | 基线变更通知 |
| `/prompt-skill-candidates/{id}/review` | POST | 审核 |
| `/prompt-skill-candidates/bulk-*` | POST | 批量操作 |
| `/workflow-promotion-reviews/{id}/approve` | POST | 发布审批 |
| `/experiment-baseline-suggestions/{id}/apply` | POST | 应用基线建议 |

#### 2.12 修复任务 (RepairTasksPage)
| 接口 | 方法 | 验证点 |
|------|------|--------|
| `/repair-tasks` | GET | 修复任务列表 |
| `/repair-tasks/{id}/tree` | GET | 任务树 |
| `/repair-tasks/{id}/start` | POST | 开始修复 |
| `/repair-tasks/{id}/resolve` | POST | 解决 |
| `/repair-tasks/{id}/assign` | POST | 分配 |
| `/repair-tasks/{id}/reopen` | POST | 重开 |

#### 2.13 Judge 审计 (JudgeAuditPage)
| 接口 | 方法 | 验证点 |
|------|------|--------|
| `/judge-profiles` | GET/POST | CRUD |
| `/judge-audits` | GET | 审计记录 |
| `/judge-audits/trends` | GET | 趋势数据 |
| `/judge-profiles/{id}/audits` | POST | 创建审计 |
| `/judge-cross-validation` | POST | 交叉验证 |

#### 2.14 治理中心 (GovernancePage)
| 接口 | 方法 | 验证点 |
|------|------|--------|
| `/skills` | GET | Skill 列表 |
| `/audit-events` | GET | 审计事件 |
| `/governance/runtime-status` | GET | 运行时状态 |
| `/model-gateway/status` | GET | 网关状态 |
| `/model-gateway/config` | GET/PUT | 配置 |
| `/model-gateway/connections` | GET/POST | 连接管理 |
| `/model-gateway/test` | POST | 连接测试 |
| `/skills/{id}/{action}` | POST | 审批/禁用/弃用 |

#### 2.15 追踪系统 (TraceTreePage + TraceFlowPage)
| 接口 | 方法 | 验证点 |
|------|------|--------|
| `/tasks/{id}/trace-tree` | GET | 追踪树 |
| `/tasks/{id}/trace-flow` | GET | 追踪流 |
| `/runs/{rid}/items/{iid}/steps/{sid}/replay` | POST | 步骤重放 |
| `/runs/{rid}/items/{iid}/steps/{sid}/prompt-debug` | POST | Prompt 调试 |
| `/runs/{rid}/items/{iid}/steps/{sid}/repro-bundle` | GET | 复现包 |

### 第 3 层: 数据流完整性 (15 min)

| 测试场景 | 涉及端点 | 验证点 |
|----------|----------|--------|
| 完整任务生命周期 | create → execute → report | 数据一致性 |
| Skill 上传→测试→审批→使用 | upload → contract-test → approve → workflow | 状态流转 |
| 工作流 草稿→发布→归档 | drafts → publish → archive | 版本管理 |
| 数据集 上传→质量诊断→修复 | upload → quality → repair | 数据血缘 |
| 报告 导出→审批→下载 | export-request → approve → download | 权限链路 |

### 第 4 层: 错误处理 (10 min)

| 场景 | 预期行为 |
|------|----------|
| 404 请求 | 前端显示友好错误提示 |
| 500 服务端错误 | 前端不白屏，显示错误边界 |
| 网络超时 | 自动重试 (502/503/504) |
| 无效参数 | 422 验证错误，前端表单提示 |
| 并发操作 | 不产生脏数据 |

---

## 三、已知问题

### 已修复
- [x] `/annotation-queue` 500 错误 — `now_beijing` 未导入 (`productization.py`)

### 待检查
- [ ] 前端 `GET /api/features` — 后端已注册，需确认响应格式匹配前端 `FeatureFlagsResponse` 类型
- [ ] 前端 `GET /api/overview/workbench` — 后端已注册，需确认 OverviewPage 是否在调用
- [ ] 前端 `GET /api/task-execution-templates` — 后端已注册，需确认 RunsPage 模板选择器是否正常
- [ ] `GET /experiments` 路由重叠 — `experiments.py` 和 `productization.py` 都注册了此路径，后者覆盖前者

---

## 四、执行步骤

### Step 1: 启动服务
```bash
# 后端
cd C:/Users/17343/Desktop/AegisQA
python -m uvicorn aegisqa.api.app:app --reload --host 127.0.0.1 --port 8000

# 前端
cd frontend && npm run dev
```

### Step 2: 逐页面手动测试
按第 2 层的分组，依次打开每个页面，检查:
1. 页面加载无白屏/报错
2. 数据正确显示
3. 操作按钮功能正常
4. 错误状态有友好提示

### Step 3: 核心流程端到端
按第 3 层场景，走完完整业务流程

### Step 4: 边界与错误场景
按第 4 层，测试异常情况

---

## 五、自动化验证脚本

```bash
# 快速验证所有 GET 端点
endpoints=(
  "/health" "/features" "/dashboard/summary" "/skills" "/skills/packages"
  "/datasets" "/workflows" "/workflow-templates" "/workflow-drafts"
  "/tasks" "/runs" "/experiments" "/ci-gates" "/annotation-queue"
  "/prompt-skill-candidates" "/judge-profiles" "/badcases"
  "/repair-tasks" "/agent-skills" "/model-gateway/status"
)

pass=0; fail=0
for ep in "${endpoints[@]}"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8000${ep}")
  if [ "$status" -ge 200 ] && [ "$status" -lt 400 ]; then
    echo "✅ ${status} ${ep}"; ((pass++))
  else
    echo "❌ ${status} ${ep}"; ((fail++))
  fi
done
echo "结果: ${pass} 通过, ${fail} 失败"
```

---

## 六、前端 TypeScript 类型对齐检查

前端 `api/client.ts` 定义了所有响应类型。需确认:
1. 后端返回的字段名与前端类型定义一致 (snake_case vs camelCase)
2. 分页结构统一: `{items: [], pagination: {total, page, page_size}}`
3. 时间字段格式统一: `YYYY-MM-DD HH:MM:SS` (北京时间)
4. 可选字段在无数据时返回 `null` 而非缺失
