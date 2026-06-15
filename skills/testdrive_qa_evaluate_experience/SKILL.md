# 体验充分度评测

评测销售是否充分介绍了产品卖点，采用两阶段流程。

## 功能说明

1. 解析算法数据中的 `testDriveQualityExperience`
2. 加载车型对应的卖点表
3. 一阶段：扫描 ASR 判断卖点是否被提及
4. 二阶段：验证提及内容是否准确

## 评测维度（2 个阶段）

| 阶段 | 维度 | 说明 |
|------|------|------|
| 一阶段 | 提及是否准确 | ASR 中是否真实提及了该二级卖点 |
| 二阶段 | 卖点错误是否判断准确 | 提及的表述内容是否准确 |

## 数据来源

```python
record["testDriveQualityExperience"] = {
    "sellingPointDetail": [
        {"key": "智能驾驶", "code": "SP001", "value": "高速NOA表现很好；自动泊车精准"}
    ],
    "errorReferDetail": [
        {"key": "智能驾驶", "value": "错误描述...", "recommendDesc": "正确描述..."}
    ]
}
```

## 输入字段

- `record`（必填）: 算法完整数据
- `ap_code`（必填）: AP 预约单号
- `asr_text`（必填）: ASR 原文
- `vehicle_name`（可选）: 车型名称

## 输出字段

- `results`: 评测结果列表
- `task_count`: 总任务数
- `stage1_count`: 一阶段任务数
- `stage2_count`: 二阶段任务数
- `correct_count`: 正确数量
- `incorrect_count`: 不正确数量

## 卖点表格式

卖点表为 JSON 文件，结构如下：

```json
[
  {
    "primary_key": "智能驾驶",
    "script": "介绍智能驾驶功能",
    "secondary_points": [
      {
        "sub_key": "高速NOA",
        "fuzzy": ["高速导航辅助", "高速自动驾驶"],
        "recommend_desc": "高速NOA表现优秀"
      }
    ]
  }
]
```
