# 试驾质检 Skills

从试驾质检项目（`D:\试驾质检周例行\testdrive`）提炼的 5 个独立评测 Skills。

## 文件结构

每个 Skill 的结构如下：

```
testdrive_qa_xxx/
├── SKILL.md          # 说明文档
├── skill.yaml        # 配置文件（输入输出 schema）
└── handler.py        # 入口脚本（包含 run 函数）
```

## Skills 列表

### 1. testdrive_qa_get_asr - 试驾 ASR 获取

**功能**: 根据 AP/AT/PATC 编号获取试驾录音的 ASR 文本及相关元数据

**上传方式**:
1. 登录 AegisQA 平台
2. 进入 Skill 市场
3. 点击"上传插件包"
4. 选择 `testdrive_qa_get_asr.zip` 文件
5. 等待合约测试通过

**输入字段**:
- `code`（必填）: AP/AT/PATC 编号
- `offline`（可选）: 是否仅使用缓存

**输出字段**:
- `asr_text`: ASR 原文
- `asr_lines`: ASR 分行列表
- `task_id`: 试驾任务 ID
- `ap_code`: AP 预约单号
- `at_code`: AT 试驾单号
- `vehicle_name`: 车型名称
- `employee_id`: 销售员工 ID
- `found`: 是否成功获取

**配置参数**:
- `api_base`: 试驾业务接口基础 URL
- `asr_base`: ASR 接口基础 URL
- `cache_file`: 本地缓存文件路径

---

### 2. testdrive_qa_get_algorithm_result - 试驾算法结果获取

**功能**: 根据 AP/AT/PATC 编号获取试驾算法 5 个模块的完整评测数据

**输入字段**:
- `code`（必填）: AP/AT/PATC 编号
- `offline`（可选）: 是否仅使用缓存

**输出字段**:
- `record`: 算法完整数据（含 5 个模块）
- `task_id`: 试驾任务 ID
- `vehicle_name`: 车型名称
- `concern_count`: 疑问回答质量条目数
- `emotion_positive_count`: 正面情感条目数
- `emotion_negative_count`: 负面情感条目数
- `found`: 是否成功获取

---

### 3. testdrive_qa_evaluate_concern_list - 疑问回答质量评测

**功能**: 对算法识别的客户疑问进行质量评测，判断 5 个维度是否正确

**评测维度**:
1. Q提取是否正确
2. 疑问是否回答判断是否正确
3. 疑问回答认可度判断是否正确
4. label 标签是否正确
5. 销售回答是否正确

**输入字段**:
- `record`（必填）: 算法完整数据
- `ap_code`（必填）: AP 预约单号
- `asr_text`（必填）: ASR 原文

**输出字段**:
- `results`: 评测结果列表
- `task_count`: 总任务数
- `correct_count`: 正确数量
- `incorrect_count`: 不正确数量
- `skipped_count`: 跳过数量

**配置参数**:
- `llm_provider`: LLM 提供商 (legacy/apihub)
- `model_api_key`: 模型 API Key
- `model_api_base`: 模型 API Base URL
- `model_name`: 模型名称
- `timeout_seconds`: LLM 调用超时时间

---

### 4. testdrive_qa_evaluate_emotion - 认可度评测

**功能**: 对算法识别的用户情感进行评测，判断情感分类、关注点和观点是否正确

**评测维度**:
1. 客户情感是否正确
2. 关注点是否正确
3. 观点是否正确

**输入字段**:
- `record`（必填）: 算法完整数据
- `ap_code`（必填）: AP 预约单号
- `asr_text`（必填）: ASR 原文

**输出字段**:
- `results`: 评测结果列表
- `task_count`: 总任务数
- `correct_count`: 正确数量
- `incorrect_count`: 不正确数量

---

### 5. testdrive_qa_evaluate_experience - 体验充分度评测

**功能**: 评测销售是否充分介绍了产品卖点，采用两阶段流程

**评测维度**:
1. 一阶段：提及是否准确
2. 二阶段：卖点错误是否判断准确

**输入字段**:
- `record`（必填）: 算法完整数据
- `ap_code`（必填）: AP 预约单号
- `asr_text`（必填）: ASR 原文
- `vehicle_name`（可选）: 车型名称

**输出字段**:
- `results`: 评测结果列表
- `task_count`: 总任务数
- `stage1_count`: 一阶段任务数
- `stage2_count`: 二阶段任务数
- `correct_count`: 正确数量
- `incorrect_count`: 不正确数量

**配置参数**:
- `selling_points_file`: 卖点表文件路径

---

## 典型工作流

```
Dataset (AP编号列表)
  → get_asr(code=row.ap_code)
  → get_algorithm_result(code=row.ap_code)
  → evaluate_concern_list(record=result.record, ap_code=row.ap_code, asr_text=asr.asr_text)
  → evaluate_emotion(record=result.record, ap_code=row.ap_code, asr_text=asr.asr_text)
  → evaluate_experience(record=result.record, ap_code=row.ap_code, asr_text=asr.asr_text)
  → report
```

## 打包上传

将每个 skill 目录打包为 zip 文件：

```powershell
cd C:\Users\wy_wangZhiGang1\Desktop\AgeisQA\skills
Compress-Archive -Path testdrive_qa_get_asr\* -DestinationPath testdrive_qa_get_asr.zip -Force
Compress-Archive -Path testdrive_qa_get_algorithm_result\* -DestinationPath testdrive_qa_get_algorithm_result.zip -Force
Compress-Archive -Path testdrive_qa_evaluate_concern_list\* -DestinationPath testdrive_qa_evaluate_concern_list.zip -Force
Compress-Archive -Path testdrive_qa_evaluate_emotion\* -DestinationPath testdrive_qa_evaluate_emotion.zip -Force
Compress-Archive -Path testdrive_qa_evaluate_experience\* -DestinationPath testdrive_qa_evaluate_experience.zip -Force
```

## 依赖说明

这些 Skills 需要：
- `network:http` 权限：调用试驾业务接口
- `model:call` 权限：调用 LLM 进行评测（评测类 Skill）
- `filesystem:skill_package_read` 权限：读取包内资源

**注意**: 当前 AegisQA 平台不支持自动安装第三方依赖，这些 Skills 仅使用 Python 标准库实现。

## 入口函数

每个 Skill 的 `handler.py` 必须暴露 `run(inputs, config)` 函数：

```python
def run(inputs, config):
    # inputs: 来自 Workflow 的输入绑定
    # config: 来自 Workflow 节点的运行参数
    return {
        "output": {...},      # 输出数据
        "metrics": {...},     # 指标数据
        "artifacts": {},      # 产物
        "logs": [...]         # 日志
    }
```
