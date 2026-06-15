# 疑问回答质量评测

对算法识别的客户疑问进行质量评测，判断 Q 提取、回答判断、认可度等 5 个维度是否正确。

## 功能说明

1. 解析算法数据中的 `testDriveQualityConcernList`
2. 为每条疑问生成 5 个评测任务
3. 调用 LLM 进行评测
4. 处理漏斗依赖关系

## 评测维度（5 个）

| 维度 | 依赖关系 | 说明 |
|------|---------|------|
| Q提取是否正确 | 入口 | `questions` 是否正确改写 `raw_question` |
| 疑问是否回答判断是否正确 | 依赖 Q 提取 | `is_answered` 是否正确 |
| 疑问回答认可度判断是否正确 | 依赖疑问回答 | `acceptance` 是否正确 |
| label 标签是否正确 | 独立 | `concernsTag` 是否正确 |
| 销售回答是否正确 | 独立 | `answer/expertReply` 是否正确 |

## 输入字段

- `record`（必填）: 算法完整数据
- `ap_code`（必填）: AP 预约单号
- `asr_text`（必填）: ASR 原文

## 输出字段

- `results`: 评测结果列表
- `task_count`: 总任务数
- `correct_count`: 正确数量
- `incorrect_count`: 不正确数量
- `skipped_count`: 跳过数量

## 漏斗依赖

- 父任务「Q提取是否正确」判定为不正确 → 子任务「疑问是否回答」跳过
- 父任务「疑问是否回答」判定为不正确 → 子任务「认可度」跳过
