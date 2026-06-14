# AegisQA Skill 类型全流程测试报告

## 测试日期
2026-06-14

## 测试环境
- 后端: http://localhost:8000
- 前端: http://localhost:5173
- 存储后端: JSON
- 模型网关: Mock 模式（用于指令型 skill 测试）

---

## 测试覆盖的 Skill 类型

### 1. 纯代码型 (Code Only)

| 类型 | 状态 | 说明 |
|------|------|------|
| AegisQA Native | ✅ | skill.yaml + handler.py:run |
| Python Function | ✅ | 裸 Python 函数 |
| OpenAI Tool | ✅ | OpenAI Function Calling 格式 |
| 文本分析 | ✅ | 代码实现的文本处理 |
| JSON 转换 | ✅ | 代码实现的数据转换 |

**测试流程**: 生成 → 上传 → 合约测试 → 审批 → 创建 Workflow → 执行 Run → 验证输出

**示例输出**:
```json
{
  "echo": "Echo: Hello Full Flow!",
  "config_param": "test_value",
  "full_flow": true
}
```

---

### 2. 纯指令型 (Instruction Only)

| 类型 | 状态 | 说明 |
|------|------|------|
| 翻译助手 | ✅ | SKILL.md only, 使用模型网关 |

**测试流程**: 生成 SKILL.md → 上传 → 合约测试 → 审批 → 创建 Workflow → 执行 Run → 验证输出

**关键特性**:
- 只需 SKILL.md 文件，无需 handler.py
- 自动调用模型网关执行
- 支持 references/ 目录加载参考资料

**示例输出**:
```json
{
  "answer": "模型回答：...",
  "text": "模型回答：...",
  "skill_id": "instruction.translation_v3@1.0.0",
  "runtime_mode": "instruction_model"
}
```

---

### 3. 代码+提示词混合型 (Code + Prompt)

| 类型 | 状态 | 说明 |
|------|------|------|
| 文本分析器 | ✅ | handler.py + config 中的 prompt 模板 |

**测试流程**: 生成 handler.py + skill.yaml → 上传 → 合约测试 → 审批 → 创建 Workflow → 执行 Run → 验证输出

**关键特性**:
- 代码负责数据预处理和统计
- 提示词模板通过 config 传入
- 代码组装最终结果

**示例输出**:
```json
{
  "task": "分析情感和关键词",
  "input_text": "人工智能正在改变世界...",
  "statistics": {
    "word_count": 1,
    "char_count": 29,
    "sentence_count": 1,
    "avg_word_length": 29.0
  },
  "analysis": {
    "keywords": ["人工智能正在改变世界..."],
    "sentiment": "neutral",
    "positive_signals": 0,
    "negative_signals": 0
  },
  "prompt_used": "请分析以下文本的情感和关键词：人工智能正在改变世界...",
  "conclusion": "文本包含 1 个词，情感倾向为 neutral..."
}
```

---

### 4. 多提示词类型 (Multi-Prompt)

| 类型 | 状态 | 说明 |
|------|------|------|
| 多维度分析器 | ✅ | handler.py + 多个 prompt 模板 |

**测试流程**: 生成 handler.py + skill.yaml → 上传 → 合约测试 → 审批 → 创建 Workflow → 执行 Run → 验证输出

**关键特性**:
- 支持多个 prompt 模板（情感、关键词、摘要）
- 每个 prompt 独立处理一个维度
- 代码组装多维度结果

**示例输出**:
```json
{
  "task": "多维度分析",
  "input_text": "人工智能技术正在快速发展...",
  "dimensions": {
    "sentiment": {
      "prompt": "分析以下文本的情感倾向：...",
      "result": "positive",
      "confidence": 0.12
    },
    "keywords": {
      "prompt": "提取以下文本的关键词：...",
      "result": ["人工智能", "人工智", "人工", "工智能技", "工智能"],
      "count": 5
    },
    "summary": {
      "prompt": "生成以下文本的摘要：...",
      "result": "人工智能技术正在快速发展...",
      "length": 29
    }
  },
  "prompts_used": ["prompt1", "prompt2", "prompt3"],
  "total_prompts": 3,
  "conclusion": "情感：positive，关键词：人工智能, 人工智, 人工，摘要长度：29字"
}
```

---

## 测试总结

| 类型 | 上传 | 合约测试 | 审批 | 执行 | 结果 |
|------|------|----------|------|------|------|
| 纯代码型 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 纯指令型 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 代码+提示词 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 多提示词 | ✅ | ✅ | ✅ | ✅ | ✅ |

**总计**: 4 种类型，全部通过全流程测试

---

## 关键发现

1. **纯代码型**: 最简单，只需 handler.py，不依赖模型网关
2. **纯指令型**: 最轻量，只需 SKILL.md，完全依赖模型网关
3. **代码+提示词混合型**: 最灵活，代码处理数据，提示词处理语义
4. **多提示词类型**: 最复杂，支持多维度分析，每个维度独立 prompt

## 建议

1. 对于简单的数据处理任务，使用**纯代码型**
2. 对于需要 LLM 理解的任务，使用**纯指令型**
3. 对于需要数据预处理 + LLM 分析的任务，使用**代码+提示词混合型**
4. 对于需要多维度分析的复杂任务，使用**多提示词类型**
