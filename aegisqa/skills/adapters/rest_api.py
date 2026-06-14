"""REST API 适配器。

支持 HTTP API 端点，自动处理请求/响应映射。
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import yaml

from aegisqa.skills.adapters.base import SkillAdapter
from aegisqa.skills.base import BaseSkill, SkillManifest, SkillResult
from aegisqa.skills.detector import _find_manifest_file

logger = logging.getLogger(__name__)


class RestApiAdapter(SkillAdapter):
    """REST API 端点适配器。

    skill.yaml 示例：
    ```yaml
    runtime:
      type: rest_api
      endpoint: https://api.example.com/v1/predict
      method: POST
      headers:
        Authorization: "Bearer ${API_KEY}"
      input_mapping:
        question: "$.input.question"
      output_mapping:
        answer: "$.data.response"
        confidence: "$.data.score"
    ```
    """

    def detect(self, package_dir: Path) -> bool:
        """检测是否为 REST API Skill。"""
        manifest_file = _find_manifest_file(package_dir)
        if not manifest_file:
            return False

        try:
            manifest = yaml.safe_load(manifest_file.read_text(encoding="utf-8"))
            runtime = manifest.get("runtime", {})
            if isinstance(runtime, dict):
                if runtime.get("type") == "rest_api" or runtime.get("endpoint"):
                    return True
            if "api" in manifest and isinstance(manifest["api"], dict):
                if manifest["api"].get("endpoint"):
                    return True
        except Exception:
            pass

        return False

    def infer_manifest(self, package_dir: Path, metadata: dict[str, Any] | None = None) -> SkillManifest:
        """从 skill.yaml 推导 manifest。"""
        manifest_file = _find_manifest_file(package_dir)
        if not manifest_file:
            raise ValueError(f"找不到 skill.yaml: {package_dir}")

        manifest_data = yaml.safe_load(manifest_file.read_text(encoding="utf-8"))
        runtime = manifest_data.get("runtime", {})
        if not isinstance(runtime, dict):
            runtime = manifest_data.get("api", {})

        endpoint = runtime.get("endpoint", "")
        method = runtime.get("method", "POST").upper()

        # 如果有显式 schema 定义，使用它
        if "input_schema" in manifest_data:
            input_schema = manifest_data["input_schema"]
        else:
            # 默认 schema
            input_schema = {
                "type": "object",
                "properties": {
                    "input": {"type": "object", "description": "API 请求体"},
                },
                "required": ["input"],
            }

        if "output_schema" in manifest_data:
            output_schema = manifest_data["output_schema"]
        else:
            output_schema = {
                "type": "object",
                "properties": {
                    "response": {"type": "object", "description": "API 响应体"},
                    "status_code": {"type": "integer", "description": "HTTP 状态码"},
                },
            }

        skill_id = manifest_data.get("skill_id", f"rest_api.{package_dir.name}@0.1.0")

        return SkillManifest(
            skill_id=skill_id,
            name=manifest_data.get("name", package_dir.name),
            version=manifest_data.get("version", "0.1.0"),
            description=manifest_data.get("description", f"REST API: {method} {endpoint}"),
            input_schema=input_schema,
            output_schema=output_schema,
            config_schema={
                "type": "object",
                "properties": {
                    "timeout": {"type": "integer", "description": "请求超时（秒）"},
                    "api_key": {"type": "string", "description": "API 密钥"},
                },
            },
            permissions=["network"],
            cacheable=manifest_data.get("cacheable", True),
            enabled=True,
            status="approved",
            tags=["auto-imported", "rest-api"],
        )

    def create_skill(self, package_dir: Path, manifest: SkillManifest) -> BaseSkill:
        """创建 REST API Skill。"""
        return RestApiSkill(package_dir, manifest)

    def get_priority(self) -> int:
        return 40


class RestApiSkill(BaseSkill):
    """REST API Skill。"""

    manifest: SkillManifest

    def __init__(self, package_dir: Path, skill_manifest: SkillManifest) -> None:
        self.manifest = skill_manifest
        self._package_dir = package_dir
        self._config = self._load_config()
        super().__init__()

    def _load_config(self) -> dict:
        """加载 API 配置。"""
        manifest_file = _find_manifest_file(self._package_dir)
        if not manifest_file:
            return {}

        manifest_data = yaml.safe_load(manifest_file.read_text(encoding="utf-8"))
        runtime = manifest_data.get("runtime", {})
        if not isinstance(runtime, dict):
            runtime = manifest_data.get("api", {})
        return runtime

    def _resolve_template(self, value: str, context: dict) -> str:
        """解析模板变量（如 ${API_KEY}）。"""
        import os
        import re

        def replace_var(match):
            var_name = match.group(1)
            # 优先从 context 获取
            if var_name in context:
                return str(context[var_name])
            # 从环境变量获取
            return os.environ.get(var_name, match.group(0))

        return re.sub(r"\$\{(\w+)\}", replace_var, value)

    def run(self, inputs: dict, config: dict) -> SkillResult:
        """执行 REST API 调用。"""
        import requests

        endpoint = self._config.get("endpoint", "")
        method = self._config.get("method", "POST").upper()
        headers = self._config.get("headers", {})
        input_mapping = self._config.get("input_mapping", {})
        output_mapping = self._config.get("output_mapping", {})

        # 解析 headers 中的模板变量
        resolved_headers = {}
        for key, value in headers.items():
            resolved_headers[key] = self._resolve_template(str(value), {**inputs, **config})

        # 应用 input_mapping
        if input_mapping:
            request_body = {}
            for target_key, source_path in input_mapping.items():
                if source_path.startswith("$."):
                    # JSONPath 风格
                    value = self._extract_jsonpath(inputs, source_path[2:])
                    request_body[target_key] = value
                else:
                    request_body[target_key] = inputs.get(source_path)
        else:
            request_body = inputs

        # 发送请求
        timeout = config.get("timeout", 30)
        try:
            if method == "GET":
                response = requests.get(endpoint, params=request_body, headers=resolved_headers, timeout=timeout)
            elif method == "POST":
                response = requests.post(endpoint, json=request_body, headers=resolved_headers, timeout=timeout)
            elif method == "PUT":
                response = requests.put(endpoint, json=request_body, headers=resolved_headers, timeout=timeout)
            else:
                response = requests.request(method, endpoint, json=request_body, headers=resolved_headers, timeout=timeout)

            response.raise_for_status()
            response_data = response.json()
        except Exception as exc:
            logger.error("REST API call failed: %s", exc)
            raise

        # 应用 output_mapping
        if output_mapping:
            output = {}
            for target_key, source_path in output_mapping.items():
                if source_path.startswith("$."):
                    value = self._extract_jsonpath(response_data, source_path[2:])
                    output[target_key] = value
                else:
                    output[target_key] = response_data.get(source_path)
        else:
            output = response_data

        output["status_code"] = response.status_code

        return SkillResult(output=output)

    def _extract_jsonpath(self, data: dict, path: str) -> Any:
        """简单的 JSONPath 提取。"""
        parts = path.split(".")
        current = data
        for part in parts:
            if isinstance(current, dict) and part in current:
                current = current[part]
            else:
                return None
        return current
