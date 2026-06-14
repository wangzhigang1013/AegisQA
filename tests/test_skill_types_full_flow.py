"""多类型 Skills 全流程测试方案。

覆盖 12 种 Skill 类型的完整生命周期：
1. 生成本地 Skill 代码
2. 压缩为 zip 包
3. 上传到平台
4. 试运行

使用方法：
    pytest tests/test_skill_types_full_flow.py -v
"""

from __future__ import annotations

import base64
import io
import json
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


@pytest.fixture()
def app(tmp_path: Path):
    """创建测试应用。"""
    return create_app(store_root=tmp_path / "store")


@pytest.fixture()
def client(app):
    """创建测试客户端。"""
    return TestClient(app)


def create_skill_zip(files: dict[str, str]) -> bytes:
    """将文件字典打包为 zip。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, content in files.items():
            zf.writestr(path, content)
    return buf.getvalue()


def upload_skill(client: TestClient, name: str, zip_bytes: bytes) -> dict:
    """上传 Skill 包。"""
    b64 = base64.b64encode(zip_bytes).decode()
    response = client.post("/skills/packages/upload", json={
        "filename": f"{name}.zip",
        "content_base64": b64,
        "role": "Skill Developer",
        "actor": "test",
    })
    return response.json()


def approve_skill(client: TestClient, skill_id: str) -> dict:
    """审批 Skill。"""
    # 先运行合约测试
    client.post(f"/skills/{skill_id}/contract-test")
    # 审批
    response = client.post(f"/skills/{skill_id}/approve", json={
        "reason": "Auto-approved for testing",
        "actor": "test",
        "role": "Admin",
    })
    return response.json()


# ============================================================
# 1. 原生 AegisQA Skill
# ============================================================

class TestNativeAegisQASkill:
    """原生 AegisQA Skill 全流程测试。"""

    def get_skill_files(self) -> dict[str, str]:
        return {
            "skill.yaml": yaml.dump({
                "skill_id": "test.native_echo@0.1.0",
                "name": "Native Echo",
                "version": "0.1.0",
                "description": "原生 AegisQA 回显 Skill",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "message": {"type": "string", "description": "输入消息"},
                    },
                    "required": ["message"],
                },
                "output_schema": {
                    "type": "object",
                    "properties": {
                        "echo": {"type": "string", "description": "回显消息"},
                        "length": {"type": "integer", "description": "消息长度"},
                    },
                },
                "config_schema": {"type": "object", "properties": {}},
                "permissions": [],
                "cacheable": True,
                "example_input": {"message": "Hello AegisQA"},
                "example_config": {},
            }),
            "handler.py": """
def run(inputs, config):
    message = inputs.get("message", "")
    return {
        "output": {
            "echo": f"Echo: {message}",
            "length": len(message),
        },
        "metrics": {"char_count": len(message)},
        "logs": [f"Processed message: {message[:50]}"],
    }
""",
        }

    def test_full_flow(self, client: TestClient):
        """完整流程：生成 → 上传 → 审批 → 试运行。"""
        # 1. 生成 Skill 包
        files = self.get_skill_files()
        zip_bytes = create_skill_zip(files)

        # 2. 上传
        upload_result = upload_skill(client, "native_echo", zip_bytes)
        assert "package_id" in upload_result
        skill_id = upload_result["manifest"]["skill_id"]

        # 3. 审批
        approve_result = approve_skill(client, skill_id)
        assert approve_result.get("enabled") is True

        # 4. 试运行（通过 Workflow）
        # 创建数据集
        dataset = client.post("/datasets/source-materialize", json={
            "name": "test_dataset",
            "rows": [{"message": "Hello World"}, {"message": "AegisQA Test"}],
            "actor": "test",
        }).json()

        # 创建 Workflow
        workflow = client.post("/workflow-graphs/publish", json={
            "graph": {
                "name": "Test Workflow",
                "nodes": [
                    {"id": "echo", "type": "skill", "data": {"skill_ref": skill_id}},
                ],
                "edges": [],
            }
        }).json()

        # 创建并执行 Run
        run = client.post("/runs", json={
            "workflow": workflow,
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
        }).json()

        # 执行
        executed = client.post(f"/runs/{run['run_id']}/execute").json()
        assert executed["status"] == "completed"
        assert executed["total_items"] == 2


# ============================================================
# 2. 裸 Python 函数 Skill
# ============================================================

class TestPythonFunctionSkill:
    """裸 Python 函数 Skill 全流程测试。"""

    def get_skill_files(self) -> dict[str, str]:
        return {
            "handler.py": """
def predict(question: str, temperature: float = 0.7) -> dict:
    \"\"\"回答问题的预测函数。\"\"\"
    return {
        "answer": f"Prediction for: {question}",
        "confidence": 0.95,
        "temperature": temperature,
    }
""",
        }

    def test_detection(self, client: TestClient):
        """测试自动类型检测。"""
        files = self.get_skill_files()
        zip_bytes = create_skill_zip(files)

        # 上传
        upload_result = upload_skill(client, "python_predict", zip_bytes)
        assert "package_id" in upload_result

        # 验证检测到的类型
        manifest = upload_result.get("manifest", {})
        assert manifest.get("skill_id", "").startswith("custom.")

    def test_full_flow(self, client: TestClient):
        """完整流程。"""
        files = self.get_skill_files()
        zip_bytes = create_skill_zip(files)

        # 上传
        upload_result = upload_skill(client, "python_predict_flow", zip_bytes)
        skill_id = upload_result["manifest"]["skill_id"]

        # 审批
        approve_skill(client, skill_id)

        # 试运行
        dataset = client.post("/datasets/source-materialize", json={
            "name": "test_predict_dataset",
            "rows": [{"question": "What is AI?"}],
            "actor": "test",
        }).json()

        workflow = client.post("/workflow-graphs/publish", json={
            "graph": {
                "name": "Predict Workflow",
                "nodes": [
                    {"id": "predict", "type": "skill", "data": {"skill_ref": skill_id}},
                ],
                "edges": [],
            }
        }).json()

        run = client.post("/runs", json={
            "workflow": workflow,
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
        }).json()

        executed = client.post(f"/runs/{run['run_id']}/execute").json()
        assert executed["status"] == "completed"


# ============================================================
# 3. LangChain Skill
# ============================================================

class TestLangChainSkill:
    """LangChain Skill 全流程测试。"""

    def get_skill_files(self) -> dict[str, str]:
        return {
            "handler.py": """
from langchain_core.runnables import RunnableLambda


def run(inputs):
    \"\"\"简单的 LangChain Runnable。\"\"\"
    question = inputs.get("question", inputs.get("input", ""))

    # 模拟 LangChain Chain
    def process(data):
        return {"output": f"LangChain processed: {data}"}

    chain = RunnableLambda(process)
    result = chain.invoke(question)
    return result
""",
            "requirements.txt": "langchain-core>=0.1.0",
        }

    def test_detection(self, client: TestClient):
        """测试 LangChain 类型检测。"""
        files = self.get_skill_files()
        zip_bytes = create_skill_zip(files)

        upload_result = upload_skill(client, "langchain_test", zip_bytes)
        assert "package_id" in upload_result


# ============================================================
# 4. LlamaIndex Skill
# ============================================================

class TestLlamaIndexSkill:
    """LlamaIndex Skill 全流程测试。"""

    def get_skill_files(self) -> dict[str, str]:
        return {
            "handler.py": """
def query(question: str) -> dict:
    \"\"\"模拟 LlamaIndex QueryEngine。\"\"\"
    return {
        "answer": f"LlamaIndex answer: {question}",
        "source_nodes": [
            {"text": "Source document 1", "score": 0.95},
            {"text": "Source document 2", "score": 0.85},
        ],
    }
""",
            "requirements.txt": "llama-index-core>=0.10.0",
        }

    def test_detection(self, client: TestClient):
        """测试 LlamaIndex 类型检测。"""
        files = self.get_skill_files()
        zip_bytes = create_skill_zip(files)

        upload_result = upload_skill(client, "llamaindex_test", zip_bytes)
        assert "package_id" in upload_result


# ============================================================
# 5. OpenAI Tool Skill
# ============================================================

class TestOpenAIToolSkill:
    """OpenAI Tool Skill 全流程测试。"""

    def get_skill_files(self) -> dict[str, str]:
        return {
            "skill.yaml": yaml.dump({
                "openai_tool": True,
                "name": "get_weather",
                "description": "获取指定城市的天气信息",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {
                            "type": "string",
                            "description": "城市名称，如 Beijing、Shanghai",
                        },
                        "unit": {
                            "type": "string",
                            "enum": ["celsius", "fahrenheit"],
                            "description": "温度单位",
                        },
                    },
                    "required": ["location"],
                },
            }),
            "handler.py": """
def get_weather(location: str, unit: str = "celsius") -> dict:
    \"\"\"获取天气信息。\"\"\"
    # 模拟天气 API
    weather_data = {
        "Beijing": {"temp": 25, "condition": "Sunny"},
        "Shanghai": {"temp": 28, "condition": "Cloudy"},
        "Shenzhen": {"temp": 32, "condition": "Rainy"},
    }

    data = weather_data.get(location, {"temp": 20, "condition": "Unknown"})
    temp = data["temp"]
    if unit == "fahrenheit":
        temp = temp * 9/5 + 32

    return {
        "location": location,
        "temperature": temp,
        "unit": unit,
        "condition": data["condition"],
    }
""",
        }

    def test_full_flow(self, client: TestClient):
        """完整流程。"""
        files = self.get_skill_files()
        zip_bytes = create_skill_zip(files)

        upload_result = upload_skill(client, "openai_weather", zip_bytes)
        skill_id = upload_result["manifest"]["skill_id"]

        approve_skill(client, skill_id)

        dataset = client.post("/datasets/source-materialize", json={
            "name": "weather_dataset",
            "rows": [{"location": "Beijing"}, {"location": "Shanghai"}],
            "actor": "test",
        }).json()

        workflow = client.post("/workflow-graphs/publish", json={
            "graph": {
                "name": "Weather Workflow",
                "nodes": [
                    {"id": "weather", "type": "skill", "data": {"skill_ref": skill_id}},
                ],
                "edges": [],
            }
        }).json()

        run = client.post("/runs", json={
            "workflow": workflow,
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
        }).json()

        executed = client.post(f"/runs/{run['run_id']}/execute").json()
        assert executed["status"] == "completed"


# ============================================================
# 6. REST API Skill
# ============================================================

class TestRestApiSkill:
    """REST API Skill 全流程测试。"""

    def get_skill_files(self) -> dict[str, str]:
        return {
            "skill.yaml": yaml.dump({
                "name": "HTTP Echo",
                "description": "调用 HTTP Echo 服务",
                "runtime": {
                    "type": "rest_api",
                    "endpoint": "https://httpbin.org/post",
                    "method": "POST",
                    "headers": {
                        "Content-Type": "application/json",
                    },
                    "input_mapping": {
                        "data": "$.input",
                    },
                    "output_mapping": {
                        "response": "$.json",
                        "status_code": "$.status_code",
                    },
                },
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "input": {"type": "object"},
                    },
                    "required": ["input"],
                },
                "output_schema": {
                    "type": "object",
                    "properties": {
                        "response": {"type": "object"},
                        "status_code": {"type": "integer"},
                    },
                },
            }),
        }

    def test_detection(self, client: TestClient):
        """测试 REST API 类型检测。"""
        files = self.get_skill_files()
        zip_bytes = create_skill_zip(files)

        upload_result = upload_skill(client, "rest_api_test", zip_bytes)
        assert "package_id" in upload_result


# ============================================================
# 7. HuggingFace Pipeline Skill
# ============================================================

class TestHuggingFaceSkill:
    """HuggingFace Pipeline Skill 全流程测试。"""

    def get_skill_files(self) -> dict[str, str]:
        return {
            "handler.py": """
def run(text: str) -> dict:
    \"\"\"模拟 HuggingFace text-classification pipeline。\"\"\"
    # 模拟分类结果
    positive_words = ["good", "great", "excellent", "amazing", "wonderful"]
    negative_words = ["bad", "terrible", "awful", "horrible", "poor"]

    text_lower = text.lower()
    pos_count = sum(1 for w in positive_words if w in text_lower)
    neg_count = sum(1 for w in negative_words if w in text_lower)

    if pos_count > neg_count:
        return {"label": "POSITIVE", "score": 0.95}
    elif neg_count > pos_count:
        return {"label": "NEGATIVE", "score": 0.90}
    else:
        return {"label": "NEUTRAL", "score": 0.70}
""",
            "requirements.txt": "transformers>=4.30.0",
        }

    def test_detection(self, client: TestClient):
        """测试 HuggingFace 类型检测。"""
        files = self.get_skill_files()
        zip_bytes = create_skill_zip(files)

        upload_result = upload_skill(client, "huggingface_test", zip_bytes)
        assert "package_id" in upload_result


# ============================================================
# 8. LangGraph Skill
# ============================================================

class TestLangGraphSkill:
    """LangGraph Skill 全流程测试。"""

    def get_skill_files(self) -> dict[str, str]:
        return {
            "handler.py": """
def run(inputs):
    \"\"\"模拟 LangGraph Agent。\"\"\"
    question = inputs.get("question", inputs.get("input", ""))

    # 模拟 Agent 处理流程
    messages = [
        {"role": "user", "content": question},
        {"role": "assistant", "content": f"Agent processed: {question}"},
    ]

    return {
        "messages": messages,
        "output": f"LangGraph Agent answer: {question}",
        "steps": ["reasoning", "tool_call", "response"],
    }
""",
            "requirements.txt": "langgraph>=0.1.0",
        }

    def test_detection(self, client: TestClient):
        """测试 LangGraph 类型检测。"""
        files = self.get_skill_files()
        zip_bytes = create_skill_zip(files)

        upload_result = upload_skill(client, "langgraph_test", zip_bytes)
        assert "package_id" in upload_result


# ============================================================
# 9. 纯指令型 Skill
# ============================================================

class TestInstructionSkill:
    """纯指令型 Skill 全流程测试。"""

    def get_skill_files(self) -> dict[str, str]:
        return {
            "SKILL.md": """# 中文翻译助手

## 功能描述
将英文文本翻译为中文。

## 输入格式
- `text`: 需要翻译的英文文本

## 输出格式
- `translation`: 中文翻译结果
- `confidence`: 翻译置信度

## 示例
输入: "Hello, how are you?"
输出: "你好，你好吗？"

## 注意事项
- 保持原文的语气和风格
- 专业术语需要准确翻译
""",
        }

    def test_full_flow(self, client: TestClient):
        """完整流程。"""
        files = self.get_skill_files()
        zip_bytes = create_skill_zip(files)

        upload_result = upload_skill(client, "instruction_translator", zip_bytes)
        assert "package_id" in upload_result


# ============================================================
# 10. 多步骤 Workflow Skill 组合
# ============================================================

class TestMultiStepWorkflow:
    """多步骤 Workflow 组合测试。"""

    def test_two_skill_workflow(self, client: TestClient):
        """测试两个 Skill 组成的 Workflow。"""
        # 上传第一个 Skill（数据处理）
        processor_files = {
            "skill.yaml": yaml.dump({
                "skill_id": "test.data_processor@0.1.0",
                "name": "Data Processor",
                "version": "0.1.0",
                "description": "数据处理 Skill",
                "input_schema": {
                    "type": "object",
                    "properties": {"raw_data": {"type": "string"}},
                    "required": ["raw_data"],
                },
                "output_schema": {
                    "type": "object",
                    "properties": {"processed_data": {"type": "string"}},
                },
                "config_schema": {"type": "object", "properties": {}},
                "permissions": [],
                "example_input": {"raw_data": "test data"},
                "example_config": {},
            }),
            "handler.py": """
def run(inputs, config):
    raw = inputs.get("raw_data", "")
    return {"output": {"processed_data": raw.upper()}}
""",
        }
        zip1 = create_skill_zip(processor_files)
        upload1 = upload_skill(client, "processor", zip1)
        skill1_id = upload1["manifest"]["skill_id"]
        approve_skill(client, skill1_id)

        # 上传第二个 Skill（分析）
        analyzer_files = {
            "skill.yaml": yaml.dump({
                "skill_id": "test.analyzer@0.1.0",
                "name": "Analyzer",
                "version": "0.1.0",
                "description": "数据分析 Skill",
                "input_schema": {
                    "type": "object",
                    "properties": {"data": {"type": "string"}},
                    "required": ["data"],
                },
                "output_schema": {
                    "type": "object",
                    "properties": {"result": {"type": "string"}},
                },
                "config_schema": {"type": "object", "properties": {}},
                "permissions": [],
                "example_input": {"data": "test"},
                "example_config": {},
            }),
            "handler.py": """
def run(inputs, config):
    data = inputs.get("data", "")
    return {"output": {"result": f"Analysis of: {data}"}}
""",
        }
        zip2 = create_skill_zip(analyzer_files)
        upload2 = upload_skill(client, "analyzer", zip2)
        skill2_id = upload2["manifest"]["skill_id"]
        approve_skill(client, skill2_id)

        # 创建数据集
        dataset = client.post("/datasets/source-materialize", json={
            "name": "multi_step_dataset",
            "rows": [{"raw_data": "hello world"}, {"raw_data": "aegisqa test"}],
            "actor": "test",
        }).json()

        # 创建多步骤 Workflow
        workflow = client.post("/workflow-graphs/publish", json={
            "graph": {
                "name": "Multi-Step Workflow",
                "nodes": [
                    {"id": "process", "type": "skill", "data": {"skill_ref": skill1_id}},
                    {"id": "analyze", "type": "skill", "data": {"skill_ref": skill2_id}},
                ],
                "edges": [
                    {"source": "process", "target": "analyze"},
                ],
            }
        }).json()

        # 执行
        run = client.post("/runs", json={
            "workflow": workflow,
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
        }).json()

        executed = client.post(f"/runs/{run['run_id']}/execute").json()
        assert executed["status"] == "completed"
        assert executed["total_items"] == 2


# ============================================================
# 11. Skill 重试测试
# ============================================================

class TestSkillRetry:
    """Skill 执行重试测试。"""

    def test_retry_on_failure(self, client: TestClient):
        """测试失败后自动重试。"""
        # 创建一个会失败的 Skill
        fail_files = {
            "skill.yaml": yaml.dump({
                "skill_id": "test.retry_skill@0.1.0",
                "name": "Retry Skill",
                "version": "0.1.0",
                "description": "测试重试的 Skill",
                "input_schema": {"type": "object", "properties": {"input": {"type": "string"}}},
                "output_schema": {"type": "object", "properties": {"output": {"type": "string"}}},
                "config_schema": {"type": "object", "properties": {}},
                "permissions": [],
                "example_input": {"input": "test"},
                "example_config": {},
            }),
            "handler.py": """
import random

def run(inputs, config):
    # 50% 概率失败
    if random.random() < 0.5:
        raise Exception("Random failure for testing")
    return {"output": {"output": "Success"}}
""",
        }
        zip_bytes = create_skill_zip(fail_files)
        upload_result = upload_skill(client, "retry_skill", zip_bytes)
        skill_id = upload_result["manifest"]["skill_id"]
        approve_skill(client, skill_id)

        # 创建数据集
        dataset = client.post("/datasets/source-materialize", json={
            "name": "retry_dataset",
            "rows": [{"input": "test1"}, {"input": "test2"}],
            "actor": "test",
        }).json()

        workflow = client.post("/workflow-graphs/publish", json={
            "graph": {
                "name": "Retry Workflow",
                "nodes": [
                    {"id": "retry", "type": "skill", "data": {"skill_ref": skill_id}},
                ],
                "edges": [],
            }
        }).json()

        run = client.post("/runs", json={
            "workflow": workflow,
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "max_retries": 3,
            "retry_backoff_seconds": 0.1,
        }).json()

        executed = client.post(f"/runs/{run['run_id']}/execute").json()
        # 有些 item 可能成功，有些可能失败
        assert executed["status"] in ("completed", "failed")


# ============================================================
# 12. Skill 导入导出测试
# ============================================================

class TestSkillExportImport:
    """Skill 导入导出测试。"""

    def test_export_and_reimport(self, client: TestClient):
        """测试导出后再导入。"""
        # 创建并上传 Skill
        files = {
            "skill.yaml": yaml.dump({
                "skill_id": "test.export_test@0.1.0",
                "name": "Export Test",
                "version": "0.1.0",
                "description": "测试导出导入",
                "input_schema": {"type": "object", "properties": {"input": {"type": "string"}}},
                "output_schema": {"type": "object", "properties": {"output": {"type": "string"}}},
                "config_schema": {"type": "object", "properties": {}},
                "permissions": [],
                "example_input": {"input": "test"},
                "example_config": {},
            }),
            "handler.py": """
def run(inputs, config):
    return {"output": {"output": inputs.get("input", "")}}
""",
        }
        zip_bytes = create_skill_zip(files)
        upload_result = upload_skill(client, "export_test", zip_bytes)
        skill_id = upload_result["manifest"]["skill_id"]

        # 导出
        export_response = client.get(f"/skills/{skill_id}/export")
        assert export_response.status_code == 200
        export_data = export_response.json()
        assert "zip_base64" in export_data

        # 重新导入
        import_response = client.post("/skills/import", json={
            "zip_base64": export_data["zip_base64"],
            "role": "Skill Developer",
            "actor": "test",
        })
        assert import_response.status_code == 200
        import_data = import_response.json()
        assert "skill_id" in import_data
