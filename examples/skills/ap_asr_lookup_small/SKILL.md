# AP ASR Lookup Small

根据输入的 `ap_code` 从包内 `data/ap_cache_sample.csv` 查询 ASR 文本，并输出到 `text` 字段。

适合验证：

- Skill 包内数据文件能用相对路径读取。
- 脚本型 Skill 不依赖外部网络。
- Dataset 字段 `row.ap_code` 可以映射到 Skill 输入。
