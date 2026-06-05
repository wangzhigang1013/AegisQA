# 示例 Skill 源码

本目录提供可重新打包的 Agent Skill 示例源码。当前桌面 `C:\Users\17343\Desktop\skills` 里已有可直接上传的 zip 包；如果换到新机器，可以用这里的源码重新生成 zip。

## 打包命令

在仓库根目录执行：

```powershell
Compress-Archive -Path examples\skills\ap_asr_lookup_small\* -DestinationPath ap_asr_lookup_small.zip -Force
Compress-Archive -Path examples\skills\answer_compare_rule\* -DestinationPath answer_compare_rule.zip -Force
```

生成的 zip 可在 AegisQA 前端“Skill 市场”上传，上传后先运行合约测试，再审批启用。

## 示例清单

| 目录 | Skill ID | 类型 | 用途 |
|---|---|---|---|
| `ap_asr_lookup_small` | `demo.ap_asr_lookup_small@0.1.0` | 脚本型 | 根据 `ap_code` 读取包内 CSV，输出 `text`。 |
| `answer_compare_rule` | `demo.answer_compare_rule.doc@0.1.0` | 脚本型 | 对 `answer/reference` 做简单词项重合度评测。 |
