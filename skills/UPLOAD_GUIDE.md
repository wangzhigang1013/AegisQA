# Skills 上传指南

## 问题说明

上传 Skill 插件包时可能出现以下错误：

### 错误 1: 缺少 permissions 字段

```
脚本型或参数型 Agent Skill 必须在 manifest 中显式声明 permissions，空列表表示无需额外权限。（SKILL_PACKAGE_PERMISSIONS_REQUIRED）
```

### 错误 2: 缺少 skill_id 字段

```
1 validation error for SkillManifest
skill_id Field required
```

## 原因分析

AegisQA 平台要求在 `skill.yaml` 中必须包含以下字段：

1. **skill_id**: Skill 的唯一标识符，格式为 `<namespace>.<skill_name>@<version>`
2. **permissions**: 权限声明，即使不需要任何权限也需要声明为空列表 `[]`

这是为了确保：
1. 唯一标识：每个 Skill 都有唯一的标识符
2. 安全审计：明确记录 Skill 需要的权限
3. 权限控制：平台可以根据权限列表限制 Skill 的行为
4. 合规性：所有 Skill 都必须明确声明其权限需求

## 解决方案

在每个 `skill.yaml` 文件中添加 `skill_id`、`permissions`、`example_input` 和 `example_config` 字段：

```yaml
skill_id: asr.your_skill_name@1.0.0  # 必须：格式为 <namespace>.<name>@<version>
name: your_skill_name
version: 1.0.0
description: 你的 Skill 描述
author: AegisQA
tags:
  - tag1
  - tag2
permissions: []  # 必须：空列表表示无需额外权限

input_schema:
  type: object
  required:
    - field1
    - field2
  properties:
    field1:
      type: string
      description: 字段1描述
    field2:
      type: string
      description: 字段2描述

# 必须：提供示例输入，用于合约测试
example_input:
  field1: "示例值1"
  field2: "示例值2"

# 必须：提供示例配置
example_config:
  option1: true
```

## 已修复的 Skills

### 1. wer_comparison.zip - 字错率对比
- **skill_id**: `asr.wer_comparison@1.0.0`
- **permissions**: `[]`（无需额外权限）
- **example_input**: `reference` + `hypothesis` 示例文本
- **功能**: 对比两份 ASR 文本，计算字错率(WER)、内容词WER、字准率和字符召回率

### 2. timestamp_role_comparison.zip - 时间戳角色对比
- **skill_id**: `asr.timestamp_role_comparison@1.0.0`
- **permissions**: `[]`（无需额外权限）
- **example_input**: 带时间戳的话段示例
- **功能**: 基于时间戳 IoU 对齐，评估 ASR 角色识别正确率

### 3. text_role_comparison.zip - 文本角色对比
- **skill_id**: `asr.text_role_comparison@1.0.0`
- **permissions**: `[]`（无需额外权限）
- **example_input**: 话段示例（无时间戳）
- **功能**: 基于文本内容相似度对齐，评估 ASR 角色识别正确率

## 常用权限列表

根据 AegisQA 项目代码，以下是可用的权限：

| 权限 | 说明 |
|------|------|
| `[]` | 无需额外权限（纯计算型 Skill） |
| `[filesystem:skill_package_read]` | 读取 Skill 包内文件 |
| `[network]` 或 `[network:access]` 或 `[http:request]` | 网络访问权限 |
| `[model:call]` | 调用 AI 模型 |

## 上传步骤

1. **检查 skill.yaml**
   - 确保包含 `permissions` 字段
   - 空列表 `[]` 表示无需额外权限
   - 如需权限，按需添加

2. **打包 zip 文件**
   - 确保 zip 包内包含 `skill.yaml` 和 `handler.py`
   - 不要包含其他无关文件

3. **上传到平台**
   - 登录 AegisQA 平台
   - 进入 Skill 市场
   - 点击"上传插件包"
   - 选择 zip 文件

4. **等待合约测试**
   - 平台会自动运行合约测试
   - 验证输入输出是否符合 schema 定义

5. **审批上线**
   - 合约测试通过后需要审批
   - 审批后即可在 Workflow 中使用

## 验证命令

运行测试脚本验证 Skills 功能：

```bash
cd C:\Users\wy_wangZhiGang1\Desktop\AgeisQA\skills
python test_skills.py
```

## 文件结构

```
skills/
├── UPLOAD_GUIDE.md                    # 本文档
├── README.md                          # 使用说明
├── test_skills.py                     # 测试脚本
├── wer_comparison/                    # 字错率对比 Skill
│   ├── skill.yaml                    # 包含 permissions: []
│   └── handler.py
├── wer_comparison.zip                 # 上传用插件包
├── timestamp_role_comparison/         # 时间戳角色对比 Skill
│   ├── skill.yaml                    # 包含 permissions: []
│   └── handler.py
├── timestamp_role_comparison.zip      # 上传用插件包
├── text_role_comparison/              # 文本角色对比 Skill
│   ├── skill.yaml                    # 包含 permissions: []
│   └── handler.py
└── text_role_comparison.zip           # 上传用插件包
```

## 注意事项

1. **必须声明 permissions**: 即使是空列表 `[]`，也必须显式声明
2. **权限最小化**: 只申请必要的权限，避免过度授权
3. **纯计算型 Skill**: 使用 `permissions: []`，无需任何额外权限
4. **文件访问**: 如需读取包内文件，使用 `[filesystem:skill_package_read]`
5. **网络访问**: 如需网络请求，使用 `[network]` 或相关权限
6. **模型调用**: 如需调用 AI 模型，使用 `[model:call]`

## 参考示例

查看 AegisQA 项目中的示例 Skill：

```bash
examples/skills/answer_compare_rule/skill.yaml  # permissions: []
examples/skills/ap_asr_lookup_small/skill.yaml   # permissions: [filesystem:skill_package_read]
```

## 原始项目

这些 Skills 从以下项目提炼：
- 项目路径：`C:\Users\wy_wangZhiGang1\Desktop\ASR-Benchmark\standalone_wer`
- 核心文件：`metrics.py`, `compare_csv.py`, `role_accuracy.py`
