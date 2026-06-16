# AegisQA 稳定性优化清单

> 聚焦: Skill 上传测试、工作流画布稳定性、模型调用可靠性、失败重试

**生成时间**: 2026-06-16  
**基于**: 源码逐行分析 (gateway.py / runner.py / dag.py / packages.py / graph.py / WorkflowDesignerPage.tsx / RunsPage.tsx)

---

## 一、Skill 上传与测试

### 1.1 合约测试无重试 ⭐⭐⭐

**现状**: `contract_test()` 只执行一次，失败直接返回 `ok: false`  
**问题**: 模型网关偶发超时/限流会导致测试误判为失败  
**优化**:
```
contract_test() 增加重试:
  - 最多重试 2 次 (共 3 次尝试)
  - 仅对 5xx/超时/网络错误重试
  - 4xx 错误 (参数错误等) 不重试
  - 返回值增加 retry_count 字段
```

### 1.2 合约测试超时不明确 ⭐⭐

**现状**: 合约测试使用 Skill 默认超时 (60s)，但前端无超时提示  
**问题**: 用户等待 60s 后才知道超时，体验差  
**优化**:
```
- 合约测试使用独立超时: 30s (而非 Skill 默认 60s)
- 前端增加进度条 + 倒计时
- 超时后显示 "测试超时，请检查 Skill 是否需要更长时间"
```

### 1.3 上传安全扫描仅 Warning 不 Block ⭐⭐

**现状**: `_skill_package_member_warnings()` 检测到 API Key 泄露/Shell 注入等只生成 warning  
**问题**: 恶意代码可以绕过检测  
**优化**:
```
高风险项改为 Block (上传失败):
  - 硬编码 API Key (sk-xxx, Bearer xxx)
  - Shell 注入模式 (os.system, subprocess.call with shell=True)
  - 网络外连模式 (requests.post to hardcoded URL)

中风险项保持 Warning:
  - 可执行文件后缀 (.exe, .sh)
  - 二进制内容
  - 直接 import 模型 SDK

低风险项保持 Warning:
  - 文件系统访问模式
```

### 1.4 Skill 包依赖被硬性拒绝 ⭐⭐

**现状**: 包含 `requirements.txt` 或 `pyproject.toml` 直接拒绝上传  
**问题**: 很多 Python Skill 需要依赖 (如 langchain, pandas)  
**优化**:
```
方案 A (推荐): 依赖声明但不安装
  - 解析 requirements.txt 记录依赖列表
  - 上传成功后提示 "此 Skill 声明了以下依赖，请确保运行环境已安装"
  - 不阻断上传

方案 B: 依赖白名单
  - 维护一个常见依赖白名单 (requests, pandas, numpy, langchain 等)
  - 白名单内允许，白名单外拒绝
```

### 1.5 指令 Skill 无测试输入 ⭐⭐

**现状**: InstructionPackageSkill 的合约测试需要 `example_input`，但用户创建时可能没填  
**问题**: 无法测试 → 无法审批 → Skill 无法使用  
**优化**:
```
- 创建指令 Skill 时自动注入测试输入: {"text": "这是一条测试文本"}
- 或提供 "快速测试" 按钮，让用户输入测试文本
- 测试结果实时显示在创建页面
```

### 1.6 上传失败无详细错误 ⭐

**现状**: 上传失败只返回 `SKILL_PACKAGE_INVALID` 等通用错误码  
**问题**: 用户不知道具体哪里出错  
**优化**:
```
错误响应增加 details 字段:
  - 具体哪个文件有问题
  - 具体违反了什么规则
  - 修复建议
```

---

## 二、工作流画布稳定性

### 2.1 DAG 分支失败不快速中断 ⭐⭐⭐

**现状**: 并行分支中一个 Step 失败，同级其他 Step 继续执行，下游 Step 也继续执行  
**问题**: 用户看到一堆级联失败，找不到根因  
**优化**:
```
DAGExecutor.execute_row() 增加 fail-fast 模式:
  - 某 Level 中任何 Step 失败 → 标记该 Level 为 failed
  - 跳过后续所有依赖该 Level 的 Step
  - 记录 "因上游 Step X 失败而跳过" 
  - 只显示根因错误，不显示级联错误
```

### 2.2 DAG 构建失败静默降级 ⭐⭐⭐

**现状**: DAG 构建失败后静默回退到线性执行，用户完全不知道  
**问题**: 用户以为是并行执行，实际是串行，性能差异巨大  
**优化**:
```
- DAG 构建失败时，前端显示 warning 弹窗:
  "工作流 DAG 构建失败，已降级为线性执行。原因: {error}"
- run 记录中增加 execution_mode 字段: "dag" | "linear"
- 报告页面显示执行模式
```

### 2.3 画布保存/试运行错误无 Banner ⭐⭐

**现状**: 保存失败和试运行失败只在底部 Console 显示，无顶部 Banner  
**问题**: 用户不看 Console 就不知道出错了  
**优化**:
```
统一错误展示模式 (对齐发布失败的处理):
  - 保存失败: 红色 Banner + Console 错误
  - 试运行失败: 红色 Banner + 结构化错误
  - 校验失败: 黄色 Banner + 自动跳转 Issues Tab
```

### 2.4 草稿加载失败无恢复路径 ⭐⭐

**现状**: 草稿加载失败显示全屏错误，无重试/返回按钮  
**问题**: 用户只能用浏览器后退  
**优化**:
```
错误页面增加:
  - "重试" 按钮 (重新加载草稿)
  - "返回列表" 按钮 (跳转 /workflows)
  - "新建草稿" 按钮 (从空白开始)
```

### 2.5 孤立节点不报错 ⭐

**现状**: 没有任何边连接的 Skill 节点可以通过校验  
**问题**: 节点永远不会执行，用户以为配置好了  
**优化**:
```
校验增加 Warning 级别:
  - "节点 X 没有连接到任何其他节点，将不会参与执行"
  - 在节点上显示 ⚠️ 图标
```

### 2.6 类型校验只报第一个错误 ⭐

**现状**: `_validate_sample_types()` 遇到第一个类型不匹配就 return  
**问题**: 用户修一个错才能看到下一个，反复校验  
**优化**:
```
收集所有类型错误后一次性返回:
  - 移除 line 295 的 early return
  - 返回 errors 列表包含所有不匹配项
```

### 2.7 正则表达式 DoS 风险 ⭐

**现状**: DAG 条件分支的 `matches` 操作符直接 `re.search(用户输入)`  
**问题**: 恶意正则 (如 `(a+)+$`) 可以挂死线程  
**优化**:
```
- 正则长度限制: 最长 200 字符
- 执行超时: 使用 signal.alarm 或 threading.Timer 限制 1s
- 预编译 + 缓存常用正则
```

---

## 三、模型调用可靠性

### 3.1 429 限流不重试 ⭐⭐⭐

**现状**: HTTP 429 (Rate Limit) 被当作 4xx 客户端错误，直接抛出不重试  
**问题**: 模型提供商限流时，整个调用直接失败  
**优化**:
```
gateway.py generate() 增加 429 特殊处理:
  - 检测 status_code == 429
  - 读取 Retry-After header (如果有)
  - 等待 min(retry_after, 30s) 后重试
  - 最多重试 3 次
  - 429 不计入 fallback 次数
```

### 3.2 无同模型重试机制 ⭐⭐⭐

**现状**: 每个模型只尝试一次，失败后直接 fallback 到下一个模型  
**问题**: 偶发网络抖动导致不必要的模型切换  
**优化**:
```
每个模型增加重试:
  - 5xx/网络错误: 重试 2 次 (共 3 次)
  - 指数退避: 1s, 2s, 4s
  - 429: 单独处理 (见 3.1)
  - 4xx (非429): 不重试
  - 总尝试次数 = 模型数 × 单模型重试数
```

### 3.3 API Key 轮换线程不安全 ⭐⭐

**现状**: `_api_key_rotation_index` 是模块级全局变量，无锁保护  
**问题**: 并发请求可能导致重复使用同一个 Key 或跳过 Key  
**优化**:
```
方案 A: 使用 threading.Lock
  _key_lock = threading.Lock()
  with _key_lock:
      key = keys[_index % len(keys)]
      _index += 1

方案 B: 使用 itertools.cycle (线程安全的迭代器)
  方案 C: 使用 thread-local 变量
```

### 3.4 JSON 解析未捕获 ⭐⭐

**现状**: 模型返回非 JSON 响应 (如 HTML 错误页) 时，`json.loads()` 抛出 `JSONDecodeError` 未被捕获  
**问题**: 500 错误，用户看到 "Internal Server Error"  
**优化**:
```python
# gateway.py _openai_compatible_generate() 中:
try:
    data = json.loads(response.read().decode("utf-8"))
except json.JSONDecodeError as e:
    raise AegisQAError(
        "MODEL_GATEWAY_INVALID_RESPONSE",
        f"模型返回了非 JSON 响应: {str(e)[:200]}",
        status_code=502,
    )
```

### 3.5 流式输出无超时 ⭐

**现状**: 流式 SSE 读取是逐行读取，如果模型停止发送数据但不断开连接，会永远阻塞  
**问题**: 一个卡住的流式请求会阻塞整个调用  
**优化**:
```
增加 chunk-level 超时:
  - 每个 chunk 读取超时: 30s
  - 总流式超时: 300s
  - 超时后断开连接，返回已收到的部分结果
```

### 3.6 模型网关配置无验证 ⭐

**现状**: `PUT /model-gateway/config` 保存配置时不验证 base_url 是否可达  
**问题**: 用户填错 URL，保存成功但所有调用都失败  
**优化**:
```
保存配置时增加可选的连通性测试:
  - 发送一个轻量级请求 (如列出模型)
  - 返回测试结果
  - 不阻断保存 (允许离线配置)
```

---

## 四、执行引擎稳定性

### 4.1 无单步超时 ⭐⭐⭐

**现状**: Runner 没有单步 (step-level) 超时，只有 Skill 自身的 subprocess 超时  
**问题**: 一个卡住的 Skill 调用会阻塞整个 Run  
**优化**:
```
增加 step-level 超时:
  - 默认: 120s (可通过 task config 覆盖)
  - 实现: 使用 threading.Timer 在子线程中 interrupt
  - 超时后: 记录 SKILL_STEP_TIMEOUT 错误，继续下一个 Step
  - 前端显示 "Step X 超时 (120s)，已跳过"
```

### 4.2 无 Run-level 超时 ⭐⭐

**现状**: 没有整个 Run 的最大执行时间限制  
**问题**: 大数据集 + 慢 Skill = 无限等待  
**优化**:
```
增加 run-level 超时:
  - 默认: 3600s (1小时)
  - 可通过 task config 覆盖
  - 超时后: 自动取消，状态设为 "timeout"
  - 已完成的 items 保留结果
```

### 4.3 重试时 blocking sleep ⭐⭐

**现状**: 重试时 `time.sleep(backoff)` 阻塞整个执行线程  
**问题**: 重试期间无法响应取消请求  
**优化**:
```
替换为可中断的 sleep:
  - 使用 Event.wait(timeout) 代替 time.sleep
  - 取消信号通过 Event.set() 中断等待
  - 或使用分段 sleep: sleep(0.5) × N 次，每次检查取消标志
```

### 4.4 取消只在 Item 边界检查 ⭐⭐

**现状**: 取消信号只在每个 item 处理前检查  
**问题**: 一个耗时 600s 的 Skill 执行期间无法取消  
**优化**:
```
增加 step-level 取消检查:
  - 在 _execute_item 的每个 step 开始前检查
  - 通过 run_controls/{run_id}.json 文件信号
  - 检查间隔: 每个 step 至少检查一次
```

### 4.5 默认重试次数为 0 ⭐

**现状**: `max_retries` 默认为 0，即不重试  
**问题**: 用户不知道可以配置重试，大多数任务失败后不会自动恢复  
**优化**:
```
修改默认值:
  - max_retries 默认改为 1 (失败后重试 1 次)
  - retry_backoff_seconds 保持 1.0
  - 前端任务创建向导中显示重试配置项
```

### 4.6 速率限制未实际执行 ⭐

**现状**: RateLimiter 只计算等待时间，Runner 不实际 sleep  
**问题**: 速率限制形同虚设，可能触发模型提供商的 429  
**优化**:
```
Runner 在 rate_limit_wait_ms > 0 时实际等待:
  - 等待时间 = rate_limit_wait_ms
  - 使用可中断的等待 (见 4.3)
  - 前端显示 "等待速率限制: {wait_ms}ms"
```

---

## 五、前端交互稳定性

### 5.1 任务轮询无退避 ⭐⭐

**现状**: 活跃任务每 1 秒轮询一次，固定频率  
**问题**: 后端压力大时雪上加霜  
**优化**:
```
自适应轮询:
  - 任务 running 时: 1s 间隔
  - 任务 queued 时: 3s 间隔
  - 连续 3 次无变化: 增加到 5s
  - 任务 completed/failed: 停止轮询
```

### 5.2 Notice 单字符串被覆盖 ⭐

**现状**: `notice` 是单个 string，快速操作会覆盖之前的错误  
**问题**: 用户看不到第一个错误  
**优化**:
```
改为 notice 数组 (消息队列):
  - 最多显示 3 条
  - 每条 5 秒后自动消失
  - 可手动关闭
```

### 5.3 Detail Task 分页后失联 ⭐

**现状**: 详情页的更新来自当前分页列表，任务翻页后详情不更新  
**问题**: 正在运行的任务详情可能停止更新  
**优化**:
```
详情页独立轮询:
  - 有 detailTask 时，独立 query 每 2s 刷新详情
  - 不依赖分页列表的更新
```

### 5.4 任务状态 queued 不轮询 ⭐

**现状**: `isLiveTaskStatus` 只检查 `running`，`queued` 状态不轮询  
**问题**: 排队中的任务状态变化不实时反映  
**优化**:
```typescript
const isLiveTaskStatus = (status: string) => 
  status === 'running' || status === 'queued' || status === 'pausing';
```

---

## 六、优先级排序

### P0 — 立即修复 (影响核心功能)

| # | 问题 | 影响 | 工作量 |
|---|------|------|--------|
| 3.1 | 429 限流不重试 | 模型调用直接失败 | 2h |
| 3.2 | 无同模型重试 | 偶发失败不恢复 | 3h |
| 3.4 | JSON 解析未捕获 | 500 错误 | 30min |
| 4.1 | 无单步超时 | Run 无限阻塞 | 3h |
| 1.1 | 合约测试无重试 | 误判失败 | 2h |
| 2.1 | DAG 不快速中断 | 级联失败掩盖根因 | 3h |

### P1 — 短期优化 (1-2 周)

| # | 问题 | 影响 | 工作量 |
|---|------|------|--------|
| 2.2 | DAG 降级静默 | 用户不知情 | 1h |
| 2.3 | 画布错误无 Banner | 错误不可见 | 2h |
| 2.4 | 草稿加载失败无恢复 | 用户卡住 | 1h |
| 3.3 | API Key 轮换不安全 | 并发问题 | 1h |
| 4.2 | 无 Run 超时 | 无限等待 | 2h |
| 4.3 | 重试 blocking sleep | 无法取消 | 2h |
| 4.5 | 默认重试为 0 | 失败不恢复 | 30min |
| 5.1 | 轮询无退避 | 后端压力 | 1h |
| 1.3 | 安全扫描不 Block | 恶意代码风险 | 2h |

### P2 — 中期优化 (2-4 周)

| # | 问题 | 影响 | 工作量 |
|---|------|------|--------|
| 1.2 | 合约测试超时体验差 | 用户体验 | 2h |
| 1.4 | 依赖硬性拒绝 | 限制 Skill 能力 | 3h |
| 1.5 | 指令 Skill 无测试输入 | 无法测试 | 2h |
| 2.6 | 类型校验只报一个 | 反复校验 | 1h |
| 4.4 | 取消只在 Item 边界 | 长任务无法取消 | 3h |
| 4.6 | 速率限制未执行 | 触发 429 | 2h |
| 5.2 | Notice 被覆盖 | 错误丢失 | 1h |
| 5.3 | Detail 失联 | 状态不更新 | 1h |
| 5.4 | queued 不轮询 | 状态延迟 | 30min |

### P3 — 低优先级

| # | 问题 | 影响 | 工作量 |
|---|------|------|--------|
| 1.6 | 上传错误不详细 | 调试困难 | 2h |
| 2.5 | 孤立节点不报错 | 误导用户 | 1h |
| 2.7 | 正则 DoS | 安全风险 | 1h |
| 3.5 | 流式无超时 | 偶发阻塞 | 2h |
| 3.6 | 配置无验证 | 填错 URL | 1h |

---

## 七、执行计划

### Week 1: P0 修复

```
Day 1: 模型网关重试机制 (3.1 + 3.2 + 3.4)
  - gateway.py: 429 特殊处理 + 同模型重试 + JSON 解析捕获
  - 测试: 模拟 429/5xx/超时场景

Day 2: 执行引擎超时 (4.1)
  - runner.py: step-level timeout
  - 测试: 模拟 Skill 卡死

Day 3: 合约测试重试 (1.1) + DAG 快速中断 (2.1)
  - base.py: contract_test 重试逻辑
  - dag.py: fail-fast 模式

Day 4: 前端错误展示 (2.2 + 2.3 + 2.4)
  - WorkflowDesignerPage.tsx: Banner + 重试按钮
  - RunsPage.tsx: queued 状态轮询

Day 5: 联调测试 + 修复回归
```

### Week 2: P1 优化

```
Day 1-2: 安全扫描升级 (1.3) + API Key 线程安全 (3.3)
Day 3: Run 超时 (4.2) + 可中断 sleep (4.3)
Day 4: 默认重试 (4.5) + 轮询退避 (5.1)
Day 5: Notice 队列 (5.2) + Detail 独立轮询 (5.3)
```
