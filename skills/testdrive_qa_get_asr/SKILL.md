# 试驾 ASR 获取

根据输入的 `code`（AP/AT/PATC 任一格式）获取试驾录音的 ASR 语音识别文本及相关元数据。

## 功能说明

1. 自动识别编号格式（AP/AT/PATC）
2. 查询本地缓存（如存在）
3. 调用接口获取 ASR 文本
4. 提取车型、员工等元数据

## 输入字段

- `code`（必填）: AP/AT/PATC 编号
- `offline`（可选）: 是否仅使用缓存，默认 false

## 输出字段

- `asr_text`: ASR 原文（以 `|` 分隔的对话）
- `asr_lines`: ASR 分行列表
- `task_id`: 试驾任务 ID
- `ap_code`: AP 预约单号
- `at_code`: AT 试驾单号
- `vehicle_name`: 车型名称
- `employee_id`: 销售员工 ID
- `employee_name`: 销售员工姓名
- `found`: 是否成功获取
- `from_cache`: 是否来自缓存

## 使用场景

- 试驾质检评测前获取 ASR 数据
- 批量获取多个 AP 的 ASR 文本
- 验证 ASR 数据完整性

## 配置参数

- `api_base`: 试驾业务接口基础 URL
- `asr_base`: ASR 接口基础 URL
- `cache_file`: 本地缓存文件路径
