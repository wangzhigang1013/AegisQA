# Answer Compare Rule

对 `answer` 和 `reference` 做简单词项重合度评测，输出 `score`、`label` 和 `reason`。

适合验证：

- 下游评测 Skill 消费上游回答。
- `config_schema.threshold` 控制通过阈值。
- 不调用模型也能完成基础 QA 回归评测。
