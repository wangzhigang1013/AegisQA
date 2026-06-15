# 试驾算法结果获取

根据输入的 `code`（AP/AT/PATC 任一格式）获取试驾算法 5 个模块的完整评测数据。

## 功能说明

1. 自动识别编号格式（AP/AT/PATC）
2. 查询本地缓存（如存在）
3. 调用接口获取算法数据
4. 提取车型、员工等元数据

## 返回的算法模块

- `testDriveQualityCompliance`: 不文明用语
- `testDriveQualityConcernList`: 疑问回答质量
- `testDriveQualityEmotion`: 认可度
- `testDriveQualityExperience`: 体验充分度
- `testDriveQualityConcernTagList`: 对比车

## 输入字段

- `code`（必填）: AP/AT/PATC 编号
- `offline`（可选）: 是否仅使用缓存，默认 false

## 输出字段

- `record`: 算法完整数据
- `task_id`: 试驾任务 ID
- `ap_code`: AP 预约单号
- `at_code`: AT 试驾单号
- `vehicle_name`: 车型名称
- `concern_count`: 疑问回答质量条目数
- `emotion_positive_count`: 正面情感条目数
- `emotion_negative_count`: 负面情感条目数
- `found`: 是否成功获取

## 使用场景

- 获取算法评测结果进行质检
- 批量获取多个 AP 的算法数据
- 验证算法数据完整性
