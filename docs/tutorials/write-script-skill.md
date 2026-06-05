# 写一个脚本型 Skill

脚本型 Skill 适合规则、转换、查表、评分等确定性逻辑。平台会在短生命周期子进程里执行入口函数，不会把用户代码 import 到 FastAPI 主进程。

## 最小目录

```text
my_rule_skill/
├── SKILL.md
├── skill.yaml
└── scripts/
    └── run.py
```

`skill.yaml` 必须声明 schema、权限和运行入口：

```yaml
skill_id: demo.my_rule@0.1.0
name: My Rule
version: 0.1.0
runtime:
  mode: script
  entrypoint: scripts/run.py:run
permissions: []
input_schema:
  type: object
  required: [text]
  properties:
    text:
      type: string
output_schema:
  type: object
  required: [ok]
  properties:
    ok:
      type: boolean
config_schema:
  type: object
  properties:
    keyword:
      type: string
example_input:
  text: AegisQA 可以跑评测。
example_config:
  keyword: 评测
```

文档中常写成 `runtime.mode=script` 和 `scripts/run.py:run`，对应的就是上面的 `runtime.mode` 与 `runtime.entrypoint`。

## 入口函数

`scripts/run.py` 暴露 `run(inputs, config)`：

```python
def run(inputs, config):
    text = inputs["text"]
    keyword = (config or {}).get("keyword", "")
    ok = keyword in text
    return {
        "output": {"ok": ok},
        "metrics": {"keyword_hit": int(ok)},
        "artifacts": {},
        "logs": ["规则执行完成"],
    }
```

返回值里的 `output` 必须满足 `output_schema`。`metrics` 会进入 Step trace 和报告聚合，`logs` 会展示在合约测试和运行日志里。

## 包内文件和权限

如果脚本需要读取包内 CSV、prompt 或规则文件，用相对路径定位包根目录：

```python
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
rules = (ROOT / "references" / "rules.md").read_text(encoding="utf-8")
```

这种包应声明：

```yaml
permissions: [filesystem:skill_package_read]
```

脚本型默认禁止访问包目录外路径。后端会阻断目录穿越、超大包、超大 stdout 和超时，并返回结构化错误码。

## 依赖限制

当前本地运行模式不会安装第三方依赖。包里如果出现 `requirements.txt`、`pyproject.toml` 或 `runtime.dependencies`，上传会返回：

```text
SKILL_PACKAGE_DEPENDENCIES_UNSUPPORTED
```

这样做是为了避免污染主服务环境。需要第三方库时，先用标准库完成最小版本；生产模式后续会用容器镜像隔离依赖。

## 打包和合约测试

```powershell
Compress-Archive -Path my_rule_skill\* -DestinationPath my_rule_skill.zip -Force
```

上传到“Skill 市场”后必须运行合约测试。合约测试会使用 `example_input` 和 `example_config` 真实执行一次 Skill，并校验输入、配置和输出 schema。合约测试通过后，才能审批启用并放进 Workflow。

可参考仓库里的示例源码：

- `examples/skills/ap_asr_lookup_small`
- `examples/skills/answer_compare_rule`
- [Skill 示例包索引](../SKILL_EXAMPLES_INDEX.md)
