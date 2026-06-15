# ASR 评测 Skills

从 ASR-Benchmark 项目提炼的三个独立评测 Skills，用于上传到 AegisQA 平台。

## Skills 列表

### 1. wer_comparison.zip - 字错率对比

**功能**: 对比两份 ASR 文本，计算字错率(WER)、内容词WER、字准率和字符召回率

**上传方式**:
1. 登录 AegisQA 平台
2. 进入 Skill 市场
3. 点击"上传插件包"
4. 选择 `wer_comparison.zip` 文件
5. 等待合约测试通过
6. 审批后即可在 Workflow 中使用

**输入字段**:
- `reference`: 基准文本（参考答案）
- `hypothesis`: 被测文本（ASR 识别结果）

**输出字段**:
- `wer`: 字错率 (Word Error Rate) 百分比
- `content_wer`: 内容词字错率（去除语气词后的 WER）
- `accuracy`: 字准率 (100 - WER)
- `coverage`: 字符召回率（匹配字符占比）

**配置参数**:
- `enable_content_wer`: 是否计算内容词WER（默认 true）
- `normalize_equivalent_chars`: 是否归一化语义等价字（默认 true）

---

### 2. timestamp_role_comparison.zip - 时间戳角色对比

**功能**: 基于时间戳 IoU 对齐，评估 ASR 角色识别正确率

**适用场景**: ASR 结果包含时间戳信息时使用

**上传方式**:
1. 登录 AegisQA 平台
2. 进入 Skill 市场
3. 点击"上传插件包"
4. 选择 `timestamp_role_comparison.zip` 文件
5. 等待合约测试通过
6. 审批后即可在 Workflow 中使用

**输入字段**:
- `reference_segments`: 基准话段列表
- `hypothesis_segments`: 被测话段列表

每个话段包含:
- `start`: 开始时间（毫秒）
- `end`: 结束时间（毫秒）
- `role`: 角色标签（如：销售1、客户2）
- `text`: 话段文本

**输出字段**:
- `role_accuracy`: 角色识别准确率（百分比）
- `total_segments`: 总话段数
- `matched_segments`: 有效匹配话段数
- `correct_segments`: 角色正确话段数
- `wrong_segments`: 角色错误话段数
- `unmatched_segments`: 未匹配话段数
- `skipped_segments`: 跳过话段数
- `avg_iou`: 平均 IoU 值
- `wrong_cases`: 错误案例列表

**配置参数**:
- `iou_threshold`: IoU 匹配阈值（默认 0.5）
- `min_duration`: 最短话段时长过滤（毫秒，默认 0）
- `normalize_roles`: 是否归一化角色标签（默认 true）

---

### 3. text_role_comparison.zip - 文本角色对比

**功能**: 基于文本内容相似度对齐，评估 ASR 角色识别正确率

**适用场景**: ASR 结果没有时间戳信息，或需要基于文本内容匹配时使用

**上传方式**:
1. 登录 AegisQA 平台
2. 进入 Skill 市场
3. 点击"上传插件包"
4. 选择 `text_role_comparison.zip` 文件
5. 等待合约测试通过
6. 审批后即可在 Workflow 中使用

**输入字段**:
- `reference_segments`: 基准话段列表
- `hypothesis_segments`: 被测话段列表

每个话段包含:
- `role`: 角色标签（如：销售1、客户2）
- `text`: 话段文本

**输出字段**:
- `role_accuracy`: 角色识别准确率（百分比）
- `total_segments`: 总话段数
- `matched_segments`: 有效匹配话段数
- `correct_segments`: 角色正确话段数
- `wrong_segments`: 角色错误话段数
- `unmatched_segments`: 未匹配话段数
- `skipped_segments`: 跳过话段数
- `avg_similarity`: 平均文本相似度
- `wrong_cases`: 错误案例列表

**配置参数**:
- `similarity_threshold`: 文本相似度匹配阈值（默认 0.6）
- `normalize_roles`: 是否归一化角色标签（默认 true）
- `normalize_text`: 是否归一化文本（默认 true）

---

## 文件结构

```
skills/
├── README.md                              # 本文档
├── test_skills.py                         # 测试脚本
├── wer_comparison/                        # 字错率对比 Skill 源码
│   ├── skill.yaml                        # Skill 定义
│   └── handler.py                        # 核心逻辑
├── wer_comparison.zip                     # 字错率对比插件包（上传用）
├── timestamp_role_comparison/             # 时间戳角色对比 Skill 源码
│   ├── skill.yaml                        # Skill 定义
│   └── handler.py                        # 核心逻辑
├── timestamp_role_comparison.zip          # 时间戳角色对比插件包（上传用）
├── text_role_comparison/                  # 文本角色对比 Skill 源码
│   ├── skill.yaml                        # Skill 定义
│   └── handler.py                        # 核心逻辑
└── text_role_comparison.zip               # 文本角色对比插件包（上传用）
```

## 测试验证

运行测试脚本验证 Skills 功能：

```bash
cd C:\Users\wy_wangZhiGang1\Desktop\AgeisQA\skills
python test_skills.py
```

## 使用示例

### 字错率对比

```python
from wer_comparison.handler import run as wer_run

result = wer_run(
    inputs={
        "reference": "理想L9是一款非常好的车",
        "hypothesis": "理想L6是一款非常好的车"
    },
    config={"enable_content_wer": True}
)

print(f"字准率: {result['output']['accuracy']}%")
print(f"字错率: {result['output']['wer']}%")
```

### 时间戳角色对比

```python
from timestamp_role_comparison.handler import run as timestamp_role_run

result = timestamp_role_run(
    inputs={
        "reference_segments": [
            {"start": 0, "end": 1000, "role": "销售1", "text": "你好"},
            {"start": 1000, "end": 2000, "role": "客户1", "text": "你好"}
        ],
        "hypothesis_segments": [
            {"start": 0, "end": 1000, "role": "销售1", "text": "你好"},
            {"start": 1000, "end": 2000, "role": "客户1", "text": "你好"}
        ]
    },
    config={"iou_threshold": 0.5}
)

print(f"角色准确率: {result['output']['role_accuracy']}%")
```

### 文本角色对比

```python
from text_role_comparison.handler import run as text_role_run

result = text_role_run(
    inputs={
        "reference_segments": [
            {"role": "销售1", "text": "您好，欢迎来到理想汽车"},
            {"role": "客户1", "text": "你好，我想看看L9"}
        ],
        "hypothesis_segments": [
            {"role": "销售1", "text": "您好，欢迎来到理想汽车"},
            {"role": "客户1", "text": "你好，我想看看L9"}
        ]
    },
    config={"similarity_threshold": 0.6}
)

print(f"角色准确率: {result['output']['role_accuracy']}%")
```

## Skills 对比

| 特性 | 字错率对比 | 时间戳角色对比 | 文本角色对比 |
|------|-----------|---------------|-------------|
| 用途 | 文本准确性 | 角色识别准确性 | 角色识别准确性 |
| 依赖 | 无 | 时间戳 | 无 |
| 匹配方式 | 编辑距离 | 时间戳IoU | 文本相似度 |
| 适用场景 | ASR文本对比 | 有时间戳的ASR | 无时间戳的ASR |

## 依赖说明

- Python 3.10+: 支持类型注解
- 无外部依赖（纯 Python 实现）

## 注意事项

1. **插件包格式**: 每个 zip 文件必须包含 `skill.yaml` 和 `handler.py`
2. **入口函数**: `handler.py` 必须暴露 `run(inputs, config)` 函数
3. **返回格式**: `run` 函数必须返回 `{"output": {...}, "metrics": {...}, "artifacts": {}, "logs": []}`
4. **合约测试**: 上传后平台会自动运行合约测试，确保输入输出符合 schema 定义
5. **审批流程**: 合约测试通过后需要审批才能在 Workflow 中使用
6. **时间戳要求**: 时间戳角色对比需要话段包含准确的时间戳信息（毫秒）
7. **文本相似度**: 文本角色对比使用 SequenceMatcher 计算相似度，阈值默认 0.6

## 原始项目

这些 Skills 从以下项目提炼：
- 项目路径：`C:\Users\wy_wangZhiGang1\Desktop\ASR-Benchmark\standalone_wer`
- 核心文件：`metrics.py`, `compare_csv.py`, `role_accuracy.py`
