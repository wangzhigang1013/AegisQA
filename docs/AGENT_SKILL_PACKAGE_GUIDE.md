# Agent Skill 包上传指南

本文说明如何把已经写好的 Agent Skill 打成 zip 包，上传到 AegisQA Skill 市场，并作为 Workflow 组件使用。

## 设计目标

AegisQA 需要把 Agent 生态里的 Skill 变成稳定的 Workflow 节点。平台关心三件事：

- 这个节点需要哪些输入字段。
- 这个节点会输出哪些字段。
- 这个节点运行时需要哪些配置参数。

因此 `SKILL.md` 负责给人和模型看，`skill.yaml` 或 `skill.json` 负责给平台看。纯参数、规则计算、脚本执行类 Skill 必须提供机器可读合约，否则 Workflow 设计器无法生成输入绑定、运行参数和下游输出候选。

## 推荐 zip 结构

```text
my_agent_skill.zip
├── SKILL.md
├── skill.yaml
├── scripts/
│   └── run.py
├── references/
│   └── rules.md
└── assets/
```

平台支持 zip 外层多一层目录，例如：

```text
my_agent_skill.zip
└── my_agent_skill/
    ├── SKILL.md
    ├── skill.yaml
    └── scripts/run.py
```

## 运行模式

### 脚本型：runtime.mode=script

适合不需要调用模型的 Skill，例如：

- 关键词命中。
- 正则检查。
- JSON 字段转换。
- 规则打分。
- 统计计算。
- 调用包内多个 Python 文件完成确定性逻辑。

`skill.yaml` 示例：

```yaml
skill_id: agent.keyword_check@0.1.0
name: 关键词检查
version: 0.1.0
description: 不调用模型的参数化关键词检查。
tags: [agent-skill, script]
runtime:
  mode: script
  entrypoint: scripts/run.py:run
input_schema:
  type: object
  required: [text]
  properties:
    text:
      type: string
      description: 要检查的文本。
config_schema:
  type: object
  required: [keywords]
  properties:
    keywords:
      type: array
      items:
        type: string
output_schema:
  type: object
  required: [hit, matched_keywords]
  properties:
    hit:
      type: boolean
    matched_keywords:
      type: array
      items:
        type: string
example_input:
  text: 这段回答存在幻觉
example_config:
  keywords: [幻觉]
```

`scripts/run.py` 示例：

```python
def run(inputs, config):
    # inputs 来自 Workflow 的输入绑定，例如 row.text 或上游节点输出。
    text = inputs["text"]
    # config 来自 Workflow 节点的运行参数，不应该混在输入绑定里。
    keywords = config["keywords"]
    matched = [item for item in keywords if item in text]
    return {
        "output": {
            "hit": bool(matched),
            "matched_keywords": matched,
        },
        "metrics": {"matched_count": len(matched)},
        "artifacts": {},
        "logs": ["关键词检查完成"],
    }
```

脚本型 Skill 的返回值必须能通过 `output_schema` 校验。下游节点直接使用：

```text
keyword.hit
keyword.matched_keywords
```

这里的 `keyword` 是 Workflow 画布里的节点 ID，不是 Skill ID。

### 说明型：runtime.mode=instruction_model

适合需要模型根据 `SKILL.md` 和 `references/` 生成结果的 Skill。平台会读取包内说明，通过统一模型网关调用模型。

```yaml
skill_id: agent.qa_helper@0.1.0
name: QA Helper
version: 0.1.0
description: 根据 Agent Skill 说明生成评测可用回答。
runtime:
  mode: instruction_model
input_schema:
  type: object
  required: [task]
  properties:
    task:
      type: string
output_schema:
  type: object
  required: [answer, text]
  properties:
    answer:
      type: string
    text:
      type: string
    skill_id:
      type: string
    runtime_mode:
      type: string
config_schema:
  type: object
  properties:
    model:
      type: string
    temperature:
      type: number
    max_tokens:
      type: integer
    max_reference_chars:
      type: integer
example_input:
  task: 请说明 AegisQA 的用途
example_config: {}
permissions: [model:call]
```

说明型 Skill 默认输出：

```text
节点ID.answer
节点ID.text
节点ID.skill_id
节点ID.runtime_mode
```

## 多个 Python 文件能不能用

可以。脚本型 Skill 的子进程工作目录是 Skill 包根目录，因此 `scripts/run.py` 可以 import 包内其他文件。

示例：

```text
my_agent_skill/
├── SKILL.md
├── skill.yaml
├── scripts/
│   ├── run.py
│   └── scorer.py
└── libs/
    ├── __init__.py
    └── normalizer.py
```

`scripts/run.py` 可以这样写：

```python
from scripts.scorer import score_text
from libs.normalizer import normalize_text


def run(inputs, config):
    # 复杂逻辑可以拆到多个 py 文件里，但入口仍保持 run(inputs, config)。
    text = normalize_text(inputs["text"])
    score = score_text(text, config)
    return {"output": {"score": score}}
```

注意：当前第一版没有做依赖安装。如果 Skill 需要第三方库，建议先只使用标准库，或把依赖接入后续的沙箱/镜像方案。

## Workflow 中如何使用

1. 在 Skill 市场上传 zip 包。
2. 打开详情，运行合约测试。
3. 合约测试通过后，在治理页审批启用。
4. 在 Workflow 画布的 Skill Palette 搜索这个 Skill。
5. 添加节点后，右侧 Inspector 会按 schema 生成：
   - 输入绑定：把 `text` 绑定到 `row.text` 或上游输出。
   - 运行参数：填写 `keywords` 等 `config_schema` 参数。
   - 输出字段：由 `output_schema` 固定，下游通过 `节点ID.字段` 使用。

示例流程：

```text
Dataset row.text
  -> keyword(text=row.text, keywords=["幻觉"])
  -> judge(answer=keyword.hit)
  -> report
```

## 为什么纯参数 Skill 必须写 skill.yaml

纯参数 Skill 不靠模型理解 `SKILL.md`，平台必须提前知道：

- `inputs` 里有哪些字段。
- `config` 里有哪些参数。
- `output` 会返回哪些字段。
- 哪个脚本函数是入口。

如果只有 `SKILL.md + scripts/run.py`，平台无法可靠生成 UI，也无法在发布前校验 Workflow。因此这种包会被拒绝，并提示补充 `skill.yaml` 或 `skill.json`。

## 合约测试是什么

合约测试会使用 manifest 里的：

- `example_input`
- `example_config`

真实执行一次 Skill，并校验：

- 输入是否符合 `input_schema`。
- 配置是否符合 `config_schema`。
- 输出是否符合 `output_schema`。
- 脚本入口或模型网关是否能正常运行。

合约测试通过只代表单个示例能运行，不代表业务效果达标。正式评测仍需要用 Dataset 创建 Task 执行。

## 安全和限制

当前保护：

- zip 路径安全检查，禁止绝对路径和 `../`。
- 脚本不 import 到 FastAPI 主进程，而是短生命周期子进程。
- 默认单次 Skill 调用超时 60 秒，可通过 `AEGISQA_PACKAGE_SKILL_TIMEOUT_SECONDS` 调整，最大 600 秒。
- stdout JSON 输出大小限制 64KB。
- 错误日志会截断并脱敏本地绝对路径。

当前限制：

- 上传仍是 base64 JSON，不适合超大包。
- 不自动安装第三方依赖。
- 没有容器级沙箱、网络白名单和资源配额。
- `assets/` 目前作为包内资源保留，未提供专门的资产索引 UI。

生产化建议：

- 改成 multipart 或对象存储上传。
- 增加包大小限制、解压大小限制和压缩炸弹检测。
- 使用容器或沙箱执行脚本。
- 增加依赖锁文件、构建缓存和镜像扫描。
- 为网络、文件、模型调用增加权限审批和审计。
