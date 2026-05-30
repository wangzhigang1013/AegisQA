"""生成 AegisQA MVP 示例数据。

运行：

```powershell
python -m aegisqa.examples.generate_demo_data
```

脚本会生成 1000 条 RAG 回归 JSONL，满足 PRD 对千级样本演示数据的要求。
"""

from __future__ import annotations

import json
from pathlib import Path


def generate_rag_dataset(path: Path, total: int = 1000) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for index in range(total):
            expected_label = "pass" if index % 5 else "fail"
            reference = "AegisQA" if expected_label == "pass" else "不存在的参考词"
            row = {
                "question": f"第 {index + 1} 条：AegisQA 如何保障 AI 评测质量?",
                "reference": reference,
                "expected_label": expected_label,
                "scene": "rag_regression",
                "model_version": "demo-model-v1",
                "prompt_version": "prompt-v1",
            }
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    return path


def main() -> None:
    output = generate_rag_dataset(Path("examples/data/rag_qa_1000.jsonl"))
    print(f"已生成：{output}")


if __name__ == "__main__":
    main()

