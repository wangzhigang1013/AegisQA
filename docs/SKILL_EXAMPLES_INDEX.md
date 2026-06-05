# Skill 示例包索引

本页把当前桌面 `C:\Users\17343\Desktop\skills` 里的可上传 zip 示例，与仓库内可复现源码对应起来。优先用桌面 zip 快速测试平台；换到新机器时，用 `examples/skills/` 下的源码重新打包。

## 桌面现成 zip

| zip | Skill ID | 类型 | 推荐用途 |
|---|---|---|---|
| `ap_asr_lookup.zip` | `demo.ap_asr_lookup@0.1.0` | 脚本型 + 包内 CSV | 根据 `ap_code` 查 ASR 文本，验证相对路径资源读取。 |
| `answer_compare_rule.zip` | `demo.answer_compare_rule@0.1.0` | 脚本型规则 | 对 `answer/reference` 做 QA 规则评测。 |
| `row_quality_probe.zip` | `demo.row_quality_probe@0.1.0` | 脚本型规则 | 检查单条样本字段质量。 |
| `sample_50_first_n.zip` | `demo.sample_50_first_n@0.1.0` | 批处理抽样 | 验证前 50 条抽样逻辑。 |
| `sample_50_seeded_random.zip` | `demo.sample_50_seeded_random@0.1.0` | 批处理抽样 | 验证固定随机种子的抽样逻辑。 |
| `agent_model_qa_helper.zip` | `agent.model_qa_helper@0.1.0` | 说明型模型 Skill | 通过统一模型网关回答问题。 |
| `agent_model_asr_summary.zip` | `agent.model_asr_summary@0.1.0` | 说明型模型 Skill | 总结 ASR 文本。 |
| `agent_model_answer_judge.zip` | `agent.model_answer_judge@0.1.0` | 说明型模型 Skill | 用模型评测回答与参考答案一致性。 |
| `agent_code_multi_prompt_router.zip` | `agent.code_multi_prompt_router@0.1.0` | 脚本型 + 多提示词资产 | 验证代码读取 `prompts/*.md` 并组合提示词。 |

## 仓库内可复现源码

| 目录 | 打包产物 | 用途 |
|---|---|---|
| `examples/skills/ap_asr_lookup_small` | `ap_asr_lookup_small.zip` | 新机器可用的小型 AP ASR 查表示例。 |
| `examples/skills/answer_compare_rule` | `answer_compare_rule.zip` | 新机器可用的 QA 规则评测示例。 |

打包命令：

```powershell
Compress-Archive -Path examples\skills\ap_asr_lookup_small\* -DestinationPath ap_asr_lookup_small.zip -Force
Compress-Archive -Path examples\skills\answer_compare_rule\* -DestinationPath answer_compare_rule.zip -Force
```

## 选择建议

- 想验证“上传包、合约测试、审批、Workflow、Task、报告导出”完整主线：使用 `ap_asr_lookup.zip` 或仓库内 `ap_asr_lookup_small.zip`。
- 想验证规则评测：使用 `answer_compare_rule.zip`。
- 想验证模型网关：使用 `agent_model_qa_helper.zip`、`agent_model_asr_summary.zip` 或 `agent_model_answer_judge.zip`。
- 想验证复杂 Agent Skill 资产：使用 `agent_code_multi_prompt_router.zip`，它会通过相对路径读取多份 prompt。

## 相关教程

- [5 分钟跑通 ASR/QA 评测](tutorials/5-minute-asr-qa-eval.md)
- [写一个脚本型 Skill](tutorials/write-script-skill.md)
- [接入真实模型](tutorials/connect-real-model.md)
- [Agent Skill 包上传指南](AGENT_SKILL_PACKAGE_GUIDE.md)
