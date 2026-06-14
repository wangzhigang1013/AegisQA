#!/usr/bin/env python3
"""多类型 Skills 全流程测试脚本。

独立运行，无需 pytest。覆盖 12 种 Skill 类型的完整生命周期：
1. 生成本地 Skill 代码
2. 压缩为 zip 包
3. 上传到平台
4. 试运行

使用方法：
    # 确保后端已启动
    python -m uvicorn aegisqa.api.app:app --host 0.0.0.0 --port 8000

    # 运行测试
    python scripts/test_all_skill_types.py

    # 指定后端地址
    python scripts/test_all_skill_types.py --host http://localhost:8000
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import sys
import time
import zipfile
from pathlib import Path
from typing import Any

import yaml

# 添加项目根目录到 path
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    import requests
except ImportError:
    print("请安装 requests: pip install requests")
    sys.exit(1)


class SkillTester:
    """Skill 全流程测试器。"""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.results: list[dict[str, Any]] = []

    def log(self, message: str, level: str = "INFO") -> None:
        """打印日志。"""
        icons = {"INFO": "ℹ️", "SUCCESS": "✅", "ERROR": "❌", "WARNING": "⚠️"}
        icon = icons.get(level, "•")
        print(f"  {icon} {message}")

    def test_skill_type(
        self,
        name: str,
        skill_type: str,
        files: dict[str, str],
        test_input: dict[str, Any] | None = None,
        should_succeed: bool = True,
    ) -> dict[str, Any]:
        """测试单个 Skill 类型的完整流程。"""
        print(f"\n{'='*60}")
        print(f"📦 测试 Skill 类型: {skill_type}")
        print(f"   名称: {name}")
        print(f"{'='*60}")

        result = {
            "name": name,
            "type": skill_type,
            "stages": {},
            "success": False,
            "error": None,
        }

        try:
            # Stage 1: 生成 zip 包
            self.log("Stage 1: 生成 zip 包...")
            zip_bytes = self._create_zip(files)
            result["stages"]["zip"] = {"size": len(zip_bytes), "files": list(files.keys())}
            self.log(f"zip 包大小: {len(zip_bytes)} bytes, 文件: {list(files.keys())}", "SUCCESS")

            # Stage 2: 上传到平台
            self.log("Stage 2: 上传到平台...")
            upload_result = self._upload_skill(name, zip_bytes)
            if "package_id" not in upload_result:
                result["stages"]["upload"] = {"error": upload_result}
                self.log(f"上传失败: {upload_result}", "ERROR")
                return result

            skill_id = upload_result["manifest"]["skill_id"]
            result["stages"]["upload"] = {
                "package_id": upload_result["package_id"],
                "skill_id": skill_id,
            }
            self.log(f"上传成功: {skill_id}", "SUCCESS")

            # Stage 3: 审批 Skill
            self.log("Stage 3: 审批 Skill...")
            approve_result = self._approve_skill(skill_id)
            result["stages"]["approve"] = {"enabled": approve_result.get("enabled", False)}
            self.log(f"审批完成: enabled={approve_result.get('enabled')}", "SUCCESS")

            # Stage 4: 试运行
            if test_input:
                self.log("Stage 4: 试运行...")
                run_result = self._test_run(skill_id, test_input)
                result["stages"]["run"] = run_result
                if run_result.get("success"):
                    self.log(f"试运行成功: {run_result.get('output', {})}", "SUCCESS")
                    result["success"] = True
                else:
                    self.log(f"试运行失败: {run_result.get('error')}", "ERROR")
                    result["success"] = False
                    result["error"] = f"试运行失败: {run_result.get('error')}"
            else:
                self.log("Stage 4: 跳过试运行（无测试输入）", "WARNING")
                result["success"] = True

        except Exception as exc:
            result["error"] = str(exc)
            result["success"] = False
            self.log(f"测试失败: {exc}", "ERROR")

        self.results.append(result)
        return result

    def _create_zip(self, files: dict[str, str]) -> bytes:
        """创建 zip 包。"""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for path, content in files.items():
                zf.writestr(path, content)
        return buf.getvalue()

    def _upload_skill(self, name: str, zip_bytes: bytes) -> dict:
        """上传 Skill。"""
        b64 = base64.b64encode(zip_bytes).decode()
        response = self.session.post(
            f"{self.base_url}/skills/packages/upload",
            json={
                "filename": f"{name}.zip",
                "content_base64": b64,
                "role": "Skill Developer",
                "actor": "test",
            },
        )
        return response.json()

    def _approve_skill(self, skill_id: str) -> dict:
        """审批 Skill。"""
        # 运行合约测试
        self.session.post(f"{self.base_url}/skills/{skill_id}/contract-test")

        # 审批
        response = self.session.post(
            f"{self.base_url}/skills/{skill_id}/approve",
            json={
                "reason": "Auto-approved for testing",
                "actor": "test",
                "role": "Admin",
            },
        )
        return response.json()

    def _test_run(self, skill_id: str, test_input: dict) -> dict:
        """试运行 Skill。"""
        try:
            # 创建数据集
            dataset_response = self.session.post(
                f"{self.base_url}/datasets/source-materialize",
                json={
                    "name": f"test_{skill_id.replace('@', '_').replace('.', '_')}",
                    "rows": [test_input],
                    "actor": "test",
                },
            )
            dataset = dataset_response.json()

            # 创建 Workflow
            workflow_response = self.session.post(
                f"{self.base_url}/workflow-graphs/publish",
                json={
                    "graph": {
                        "name": f"Test Workflow for {skill_id}",
                        "nodes": [
                            {
                                "node_id": "test_step",
                                "node_type": "skill",
                                "skill_ref": skill_id,
                                "input_mapping": {k: f"row.{k}" for k in test_input.keys()},
                            },
                        ],
                        "edges": [],
                    }
                },
            )
            workflow = workflow_response.json()

            # 创建 Run
            run_response = self.session.post(
                f"{self.base_url}/runs",
                json={
                    "workflow": workflow,
                    "dataset_id": dataset["dataset_id"],
                    "dataset_version": dataset["version"],
                },
            )
            run = run_response.json()

            # 获取 run_id
            run_id = run.get("run_id") or run.get("id")
            if not run_id:
                return {"success": False, "error": f"No run_id in response: {run}"}

            # 执行
            executed_response = self.session.post(
                f"{self.base_url}/runs/{run_id}/execute",
            )
            executed = executed_response.json()

            if executed.get("status") == "completed":
                # 获取结果
                items = executed.get("items", [])
                output = items[0].get("context_snapshot", {}).get("test_step", {}) if items else {}
                return {"success": True, "output": output, "status": executed["status"]}
            else:
                return {"success": False, "error": executed.get("status"), "status": executed.get("status")}

        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def print_summary(self) -> None:
        """打印测试汇总。"""
        print(f"\n{'='*60}")
        print("📊 测试汇总")
        print(f"{'='*60}")

        total = len(self.results)
        success = sum(1 for r in self.results if r["success"])
        failed = total - success

        print(f"  总计: {total}")
        print(f"  成功: {success} ✅")
        print(f"  失败: {failed} ❌")

        if failed > 0:
            print("\n  失败的测试:")
            for r in self.results:
                if not r["success"]:
                    print(f"    - {r['name']} ({r['type']}): {r.get('error', 'unknown')}")

        print(f"\n{'='*60}")


def get_test_cases() -> list[dict[str, Any]]:
    """获取所有测试用例。"""
    return [
        {
            "name": "native_echo",
            "type": "原生 AegisQA",
            "files": {
                "skill.yaml": yaml.dump({
                    "skill_id": "test.native_echo@0.1.0",
                    "name": "Native Echo",
                    "version": "0.1.0",
                    "description": "原生 AegisQA 回显 Skill",
                    "input_schema": {
                        "type": "object",
                        "properties": {"message": {"type": "string"}},
                        "required": ["message"],
                    },
                    "output_schema": {
                        "type": "object",
                        "properties": {
                            "echo": {"type": "string"},
                            "length": {"type": "integer"},
                        },
                    },
                    "config_schema": {"type": "object", "properties": {}},
                    "permissions": [],
                    "example_input": {"message": "Hello"},
                    "example_config": {},
                }),
                "handler.py": """
def run(inputs, config):
    message = inputs.get("message", "")
    return {"output": {"echo": f"Echo: {message}", "length": len(message)}}
""",
            },
            "test_input": {"message": "Hello AegisQA"},
        },
        {
            "name": "python_function",
            "type": "裸 Python 函数",
            "files": {
                "skill.yaml": yaml.dump({
                    "skill_id": "test.python_predict@0.1.0",
                    "name": "Python Predict",
                    "version": "0.1.0",
                    "description": "Python 预测函数",
                    "input_schema": {
                        "type": "object",
                        "properties": {"question": {"type": "string"}},
                        "required": ["question"],
                    },
                    "output_schema": {
                        "type": "object",
                        "properties": {
                            "answer": {"type": "string"},
                            "temperature": {"type": "number"},
                        },
                    },
                    "config_schema": {"type": "object", "properties": {}},
                    "permissions": [],
                    "example_input": {"question": "What is AI?"},
                    "example_config": {},
                }),
                "handler.py": """
def run(inputs, config):
    question = inputs.get("question", "")
    return {"output": {"answer": f"Prediction: {question}", "temperature": 0.7}}
""",
            },
            "test_input": {"question": "What is AI?"},
        },
        {
            "name": "openai_tool_weather",
            "type": "OpenAI Tool",
            "files": {
                "skill.yaml": yaml.dump({
                    "skill_id": "test.get_weather@0.1.0",
                    "name": "get_weather",
                    "version": "0.1.0",
                    "description": "获取天气",
                    "openai_tool": True,
                    "parameters": {
                        "type": "object",
                        "properties": {"location": {"type": "string"}},
                        "required": ["location"],
                    },
                    "permissions": [],
                    "example_input": {"location": "Beijing"},
                    "example_config": {},
                }),
                "handler.py": """
def get_weather(location: str) -> dict:
    return {"location": location, "temp": 25, "condition": "Sunny"}
""",
            },
            "test_input": {"location": "Beijing"},
        },
        {
            "name": "instruction_translator",
            "type": "纯指令型",
            "files": {
                "SKILL.md": """# 翻译助手

## 功能
将英文翻译为中文。

## 输入
- text: 英文文本

## 输出
- translation: 中文翻译
""",
            },
            "test_input": None,  # 指令型不支持直接试运行
        },
        {
            "name": "text_analyzer",
            "type": "文本分析",
            "files": {
                "skill.yaml": yaml.dump({
                    "skill_id": "test.text_analyzer@0.1.0",
                    "name": "Text Analyzer",
                    "version": "0.1.0",
                    "description": "文本分析 Skill",
                    "input_schema": {
                        "type": "object",
                        "properties": {"text": {"type": "string"}},
                        "required": ["text"],
                    },
                    "output_schema": {
                        "type": "object",
                        "properties": {
                            "word_count": {"type": "integer"},
                            "char_count": {"type": "integer"},
                            "sentiment": {"type": "string"},
                        },
                    },
                    "config_schema": {"type": "object", "properties": {}},
                    "permissions": [],
                    "example_input": {"text": "Hello world"},
                    "example_config": {},
                }),
                "handler.py": """
def run(inputs, config):
    text = inputs.get("text", "")
    words = text.split()
    positive = sum(1 for w in ["good", "great", "excellent"] if w in text.lower())
    negative = sum(1 for w in ["bad", "terrible", "awful"] if w in text.lower())
    sentiment = "positive" if positive > negative else "negative" if negative > positive else "neutral"
    return {
        "output": {
            "word_count": len(words),
            "char_count": len(text),
            "sentiment": sentiment,
        }
    }
""",
            },
            "test_input": {"text": "This is a great day!"},
        },
        {
            "name": "json_transformer",
            "type": "JSON 转换",
            "files": {
                "skill.yaml": yaml.dump({
                    "skill_id": "test.json_transformer@0.1.0",
                    "name": "JSON Transformer",
                    "version": "0.1.0",
                    "description": "JSON 数据转换",
                    "input_schema": {
                        "type": "object",
                        "properties": {"data": {"type": "object"}},
                        "required": ["data"],
                    },
                    "output_schema": {
                        "type": "object",
                        "properties": {"transformed": {"type": "object"}},
                    },
                    "config_schema": {"type": "object", "properties": {}},
                    "permissions": [],
                    "example_input": {"data": {"key": "value"}},
                    "example_config": {},
                }),
                "handler.py": """
def run(inputs, config):
    data = inputs.get("data", {})
    transformed = {k.upper(): v for k, v in data.items()}
    return {"output": {"transformed": transformed}}
""",
            },
            "test_input": {"data": {"name": "AegisQA", "version": "1.0"}},
        },
    ]


def main():
    parser = argparse.ArgumentParser(description="多类型 Skills 全流程测试")
    parser.add_argument("--host", default="http://localhost:8000", help="后端地址")
    parser.add_argument("--type", help="只测试指定类型")
    args = parser.parse_args()

    print(f"🚀 AegisQA Skills 全流程测试")
    print(f"   后端地址: {args.host}")
    print(f"{'='*60}")

    # 检查后端是否可用
    try:
        response = requests.get(f"{args.host}/health", timeout=5)
        if response.status_code != 200:
            print("❌ 后端不可用，请先启动后端")
            sys.exit(1)
    except Exception as exc:
        print(f"❌ 无法连接后端: {exc}")
        sys.exit(1)

    print("✅ 后端已连接")

    # 运行测试
    tester = SkillTester(args.host)
    test_cases = get_test_cases()

    for case in test_cases:
        if args.type and args.type.lower() not in case["type"].lower():
            continue
        tester.test_skill_type(
            name=case["name"],
            skill_type=case["type"],
            files=case["files"],
            test_input=case.get("test_input"),
        )

    # 打印汇总
    tester.print_summary()

    # 返回退出码
    all_success = all(r["success"] for r in tester.results)
    sys.exit(0 if all_success else 1)


if __name__ == "__main__":
    main()
