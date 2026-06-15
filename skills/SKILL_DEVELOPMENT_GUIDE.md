# Skill 开发指南与问题总结

本文档总结了开发 AegisQA Skill 插件包时遇到的所有问题和解决方案，用于避免后续开发时重复踩坑。

---

## 常见问题汇总

### 问题 1: 缺少 `skill_id` 字段

**错误信息:**
```
1 validation error for SkillManifest
skill_id Field required [type=missing, input_value={'name': 'wer_comparison'...}, input_type=dict]
```

**原因:**
`skill_id` 是 Skill 的唯一标识符，平台必须通过它来识别和管理 Skill。

**解决方案:**
在 `skill.yaml` 第一行添加 `skill_id` 字段，格式为 `<namespace>.<skill_name>@<version>`。

```yaml
skill_id: asr.wer_comparison@1.0.0
```

**命名规范:**
- namespace: 使用小写字母，表示领域（如 `asr`、`qa`、`nlp`）
- skill_name: 使用小写字母和下划线
- version: 使用语义化版本号（如 `1.0.0`）

---

### 问题 2: 缺少 `permissions` 字段

**错误信息:**
```
脚本型或参数型 Agent Skill 必须在 manifest 中显式声明 permissions，空列表表示无需额外权限。（SKILL_PACKAGE_PERMISSIONS_REQUIRED，trace_id=trace_d54d45c0a373）
```

**原因:**
AegisQA 平台要求所有 Skill 必须显式声明所需的权限，用于安全审计和权限控制。

**解决方案:**
在 `skill.yaml` 中添加 `permissions` 字段，即使不需要任何权限也要声明为空列表。

```yaml
permissions: []  # 无需额外权限
```

**常用权限值:**

| 权限 | 说明 | 使用场景 |
|------|------|---------|
| `[]` | 无需额外权限 | 纯计算型 Skill |
| `[filesystem:skill_package_read]` | 读取包内文件 | 需要读取配置文件、数据文件 |
| `[network]` 或 `[network:access]` | 网络访问 | 需要调用外部 API |
| `[http:request]` | HTTP 请求 | 需要发送 HTTP 请求 |
| `[model:call]` | 调用 AI 模型 | 需要调用 LLM |

---

### 问题 3: 缺少 `example_input` 和 `example_config` 字段

**错误信息:**
```
合约测试失败：字段 $.reference_segments 类型不匹配：期望 required，实际 missing
```

**原因:**
平台在上传时会运行合约测试，使用 `example_input` 和 `example_config` 来验证：
1. 输入是否符合 `input_schema` 定义
2. 输出是否符合 `output_schema` 定义
3. Skill 是否能正常执行

**解决方案:**
在 `skill.yaml` 中添加 `example_input` 和 `example_config` 字段，提供符合 schema 的示例数据。

```yaml
example_input:
  field1: "示例值1"
  field2: "示例值2"

example_config:
  option1: true
  option2: 0.5
```

**注意事项:**
- `example_input` 必须包含 `input_schema` 中所有 `required` 字段
- `example_config` 可以只包含需要修改默认值的字段
- 示例数据应该尽可能真实，便于理解和测试

---

## 完整的 skill.yaml 模板

### 基础模板

```yaml
# ========== 必需字段 ==========
skill_id: namespace.skill_name@1.0.0  # 唯一标识符
name: skill_name                       # Skill 名称
version: 1.0.0                         # 版本号
description: Skill 描述                # 功能描述
author: AegisQA                        # 作者
tags:                                  # 标签列表
  - tag1
  - tag2
permissions: []                        # 权限声明

# ========== Schema 定义 ==========
input_schema:
  type: object
  required:
    - required_field
  properties:
    required_field:
      type: string
      description: 必需字段描述
    optional_field:
      type: string
      description: 可选字段描述

output_schema:
  type: object
  properties:
    result:
      type: string
      description: 结果字段描述

config_schema:
  type: object
  properties:
    option1:
      type: boolean
      default: true
      description: 配置选项描述

# ========== 示例数据（必需） ==========
example_input:
  required_field: "示例值"

example_config:
  option1: true
```

### 数组类型输入模板

```yaml
input_schema:
  type: object
  required:
    - items
  properties:
    items:
      type: array
      description: 数据列表
      items:
        type: object
        required:
          - name
          - value
        properties:
          name:
            type: string
            description: 名称
          value:
            type: number
            description: 值

example_input:
  items:
    - name: "item1"
      value: 100
    - name: "item2"
      value: 200
```

---

## 开发检查清单

在上传 Skill 之前，请检查以下所有项目：

### 1. 文件结构检查

- [ ] zip 包内包含 `skill.yaml` 文件
- [ ] zip 包内包含 `handler.py` 文件
- [ ] `handler.py` 中有 `run(inputs, config)` 函数
- [ ] 没有包含无关文件（如 `__pycache__`、`.pyc` 等）

### 2. skill.yaml 必需字段检查

- [ ] `skill_id` 字段存在且格式正确（`namespace.name@version`）
- [ ] `name` 字段存在
- [ ] `version` 字段存在
- [ ] `description` 字段存在
- [ ] `author` 字段存在
- [ ] `tags` 字段存在（可以是空列表）
- [ ] `permissions` 字段存在（可以是空列表 `[]`）

### 3. Schema 定义检查

- [ ] `input_schema` 定义完整
- [ ] `output_schema` 定义完整
- [ ] `config_schema` 定义完整（如有配置项）
- [ ] 所有 `required` 字段都有对应的 `properties` 定义

### 4. 示例数据检查

- [ ] `example_input` 字段存在
- [ ] `example_input` 包含所有 `required` 字段
- [ ] `example_input` 中的数据类型与 schema 定义一致
- [ ] `example_config` 字段存在（可以是空对象 `{}`）

### 5. handler.py 检查

- [ ] `run` 函数签名正确：`def run(inputs: dict, config: dict) -> dict`
- [ ] 返回值格式正确：`{"output": {...}, "metrics": {...}, "artifacts": {...}, "logs": [...]}`
- [ ] 没有使用外部依赖（或已声明在 requirements.txt 中）
- [ ] 没有访问包外文件（除非声明了相应权限）
- [ ] 没有网络请求（除非声明了相应权限）

---

## 常见错误与解决方法

### 错误 1: Schema 类型不匹配

**现象:** 合约测试失败，提示字段类型不匹配

**原因:** `example_input` 中的数据类型与 `input_schema` 定义不一致

**解决方法:**
- 检查 `example_input` 中每个字段的类型
- 确保 `string` 类型用引号包裹
- 确保 `number`/`integer` 类型是数字而非字符串
- 确保 `array` 类型是列表而非字符串
- 确保 `object` 类型是字典而非字符串

### 错误 2: 缺少必需字段

**现象:** 合约测试失败，提示字段 missing

**原因:** `example_input` 中缺少 `input_schema` 中定义的 `required` 字段

**解决方法:**
- 检查 `input_schema` 中的 `required` 列表
- 确保 `example_input` 包含所有必需字段

### 错误 3: 输出格式错误

**现象:** 合约测试失败，提示输出不符合 schema

**原因:** `handler.py` 的返回值格式不正确

**解决方法:**
- 确保返回值包含 `output`、`metrics`、`artifacts`、`logs` 四个字段
- 确保 `output` 中的字段与 `output_schema` 定义一致
- 示例：
```python
return {
    "output": {"result": "value"},
    "metrics": {"accuracy": 0.95},
    "artifacts": {},
    "logs": ["执行成功"]
}
```

### 错误 4: 权限不足

**现象:** 执行时报错 `SKILL_PACKAGE_NETWORK_DENIED` 或 `SKILL_PACKAGE_FILE_ACCESS_DENIED`

**原因:** Skill 尝试访问网络或文件，但未声明相应权限

**解决方法:**
- 如果需要访问网络，在 `permissions` 中添加 `[network]`
- 如果需要读取包内文件，在 `permissions` 中添加 `[filesystem:skill_package_read]`
- 如果只需要纯计算，使用 `permissions: []`

---

## 示例参考

查看 AegisQA 项目中的示例 Skill：

```bash
# 简单的规则型 Skill（无额外权限）
examples/skills/answer_compare_rule/skill.yaml

# 需要读取文件的 Skill
examples/skills/ap_asr_lookup_small/skill.yaml
```

---

## 快速创建 Skill 脚本

可以使用以下脚本快速创建符合规范的 Skill 结构：

```bash
#!/bin/bash
# create_skill.sh

SKILL_NAME=$1
NAMESPACE=${2:-asr}
VERSION=${3:-1.0.0}

mkdir -p $SKILL_NAME

cat > $SKILL_NAME/skill.yaml << EOF
skill_id: ${NAMESPACE}.${SKILL_NAME}@${VERSION}
name: ${SKILL_NAME}
version: ${VERSION}
description: TODO: 填写 Skill 描述
author: AegisQA
tags:
  - TODO
permissions: []

input_schema:
  type: object
  required:
    - TODO
  properties:
    TODO:
      type: string
      description: TODO

output_schema:
  type: object
  properties:
    result:
      type: string
      description: 结果

config_schema:
  type: object
  properties: {}

example_input:
  TODO: "示例值"

example_config: {}
EOF

cat > $SKILL_NAME/handler.py << 'EOF'
"""
TODO: 填写 Skill 描述
"""


def run(inputs: dict, config: dict) -> dict:
    """
    Skill 入口函数

    Args:
        inputs: 输入数据
        config: 配置参数

    Returns:
        {
            "output": {...},
            "metrics": {...},
            "artifacts": {},
            "logs": []
        }
    }
    # TODO: 实现 Skill 逻辑
    result = inputs.get("TODO", "")

    return {
        "output": {"result": result},
        "metrics": {},
        "artifacts": {},
        "logs": ["执行成功"]
    }
EOF

echo "Skill '$SKILL_NAME' 创建成功！"
echo "请编辑 $SKILL_NAME/skill.yaml 和 $SKILL_NAME/handler.py"
```

---

## 总结

开发 AegisQA Skill 时，必须确保 `skill.yaml` 包含以下字段：

| 字段 | 必需 | 说明 |
|------|------|------|
| `skill_id` | ✅ | 唯一标识符，格式 `namespace.name@version` |
| `name` | ✅ | Skill 名称 |
| `version` | ✅ | 版本号 |
| `description` | ✅ | 功能描述 |
| `author` | ✅ | 作者 |
| `tags` | ✅ | 标签列表 |
| `permissions` | ✅ | 权限声明，空列表 `[]` 表示无需权限 |
| `input_schema` | ✅ | 输入 schema 定义 |
| `output_schema` | ✅ | 输出 schema 定义 |
| `config_schema` | ⚠️ | 配置 schema 定义（有配置项时必需） |
| `example_input` | ✅ | 示例输入，用于合约测试 |
| `example_config` | ✅ | 示例配置，用于合约测试 |

遵循本文档的规范和检查清单，可以避免大部分上传失败的问题。
