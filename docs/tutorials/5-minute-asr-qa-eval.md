# 5 分钟跑通 ASR/QA 评测

这条教程用于验证 AegisQA 的主链路：上传数据、上传 Skill、合约测试、审批启用、发布 Workflow、创建并执行 Task、查看并导出报告。

## 准备

启动后端和前端：

```powershell
python -m uvicorn aegisqa.api.app:app --reload --host 127.0.0.1 --port 8000
```

```powershell
cd frontend
npm install
npm run dev
```

打开 `http://localhost:5173`。

## 准备示例 Skill

当前机器可以直接使用桌面包：

- `C:\Users\17343\Desktop\skills\ap_asr_lookup.zip`
- `C:\Users\17343\Desktop\skills\answer_compare_rule.zip`

新机器可以在仓库根目录重新打包：

```powershell
Compress-Archive -Path examples\skills\ap_asr_lookup_small\* -DestinationPath ap_asr_lookup_small.zip -Force
Compress-Archive -Path examples\skills\answer_compare_rule\* -DestinationPath answer_compare_rule.zip -Force
```

## 准备数据

创建一个 CSV，例如 `quick_asr_eval.csv`：

```csv
ap_code,question,answer,reference
AP001,AegisQA 是什么,AegisQA 是 AI 评测平台,AI 评测 平台
AP002,订单需要怎么处理,请核对订单金额并人工复核,订单 金额 人工复核
AP003,这个样本做什么,测试 ap_code 到 text 的查表流程,ap_code text 查表
```

其中 `ap_code` 会输入给 ASR 查表 Skill，`answer/reference` 会输入给 QA 规则评测 Skill。

## 上传并启用 Skill

1. 进入“Skill 市场”。
2. 上传 `ap_asr_lookup.zip` 或新机器生成的 `ap_asr_lookup_small.zip`。
3. 上传 `answer_compare_rule.zip`。
4. 对每个包点击“运行合约测试”。
5. 合约测试通过后，在治理/审批入口启用 Skill。

如果只想先跑 QA，可只上传 `answer_compare_rule.zip`；如果要验证 ASR 查表，则先上传 ASR 包。

## 上传数据集

1. 进入“数据集”。
2. 上传 `quick_asr_eval.csv`。
3. 确认字段里出现 `row.ap_code`、`row.question`、`row.answer`、`row.reference`。

## 创建 Workflow

进入“Workflow 画布”，创建草稿：

1. 添加 ASR 查表节点，Skill 选择 `demo.ap_asr_lookup@0.1.0` 或 `demo.ap_asr_lookup_small@0.1.0`。
2. 输入绑定：`ap_code = row.ap_code`。
3. 输出字段会包含 `text` 和 `found`。
4. 添加 QA 规则评测节点，Skill 选择 `demo.answer_compare_rule@0.1.0` 或 `demo.answer_compare_rule.doc@0.1.0`。
5. 输入绑定：`question = row.question`、`answer = row.answer`、`reference = row.reference`。
6. 运行参数：`threshold = 0.5`。
7. 点击校验，通过后发布 Workflow。

如果要把 ASR 查表结果送入 QA 节点，可以把 QA 节点的 `answer` 改为上游节点输出，例如 `asr.text`。

## 创建并执行 Task

1. 进入“执行中心”。
2. 点击“创建任务”。
3. 选择刚上传的数据集和刚发布的 Workflow。
4. 运行 Preflight。
5. Preflight 通过后创建 Task。
6. 点击“执行”，等待状态变为 completed。

暂停、恢复、取消和重试失败都在任务详情抽屉里操作。

## 查看并导出报告

1. 进入“报告中心”。
2. 选择刚才的 Task。
3. 查看通过率、Badcase、Step 分布和 Preflight 证据。
4. 点击“导出 HTML”“导出 CSV”或“导出 JSON”。
5. 需要完整外发审计材料时，点击“导出离线包”。

到这里，已经完成从数据到报告导出的最小 ASR/QA 评测闭环。
