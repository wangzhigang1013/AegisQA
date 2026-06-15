# 认可度评测

对算法识别的用户情感（满意/不满意/中立）进行评测，判断情感分类、关注点和观点是否正确。

## 功能说明

1. 解析算法数据中的 `testDriveQualityEmotion`
2. 处理三类情感数据：positive、negative、concern
3. 为每条情感生成 2-3 个评测任务
4. 调用 LLM 进行评测

## 评测维度（3 个）

| 维度 | 依赖关系 | 说明 |
|------|---------|------|
| 客户情感是否正确 | 入口 | positive/negative/concern 分类是否正确 |
| 关注点是否正确 | 依赖情感 | interest/concern 关注点判断 |
| 观点是否正确 | 依赖关注点 | re_write 观点总结是否准确 |

## 数据结构

```python
{
    "positive": [{"originalText": "...", "point": "...", "reWrite": "..."}],
    "negative": [{"originalText": "...", "point": "...", "reWrite": "..."}],
    "concern": [{"interests": {...}, "concerns": {...}}]
}
```

## 输入字段

- `record`（必填）: 算法完整数据
- `ap_code`（必填）: AP 预约单号
- `asr_text`（必填）: ASR 原文

## 输出字段

- `results`: 评测结果列表
- `task_count`: 总任务数
- `correct_count`: 正确数量
- `incorrect_count`: 不正确数量
