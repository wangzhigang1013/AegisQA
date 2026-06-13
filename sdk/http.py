"""HTTP 客户端封装。"""

from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .exceptions import AegisQAError, AuthenticationError, NotFoundError, ValidationError


class HTTPClient:
    """HTTP 客户端。"""

    def __init__(
        self,
        base_url: str,
        api_key: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        """发送 GET 请求。"""
        url = self._build_url(path, params)
        return self._request("GET", url)

    def post(self, path: str, data: dict[str, Any] | None = None) -> Any:
        """发送 POST 请求。"""
        url = self._build_url(path)
        return self._request("POST", url, data)

    def put(self, path: str, data: dict[str, Any] | None = None) -> Any:
        """发送 PUT 请求。"""
        url = self._build_url(path)
        return self._request("PUT", url, data)

    def delete(self, path: str) -> Any:
        """发送 DELETE 请求。"""
        url = self._build_url(path)
        return self._request("DELETE", url)

    def _build_url(self, path: str, params: dict[str, Any] | None = None) -> str:
        """构建完整 URL。"""
        path = path.lstrip("/")
        url = f"{self.base_url}/{path}"
        if params:
            query = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
            if query:
                url = f"{url}?{query}"
        return url

    def _request(self, method: str, url: str, data: dict[str, Any] | None = None) -> Any:
        """发送 HTTP 请求。"""
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        body = json.dumps(data, ensure_ascii=False).encode("utf-8") if data else None
        request = Request(url, data=body, headers=headers, method=method)

        try:
            with urlopen(request, timeout=self.timeout) as response:
                content = response.read().decode("utf-8")
                if not content:
                    return None
                return json.loads(content)
        except HTTPError as exc:
            self._handle_http_error(exc, url)
        except (URLError, TimeoutError, OSError) as exc:
            raise AegisQAError(
                message=f"请求失败：{exc}",
                details={"url": url, "error": str(exc)},
            ) from exc

    def _handle_http_error(self, exc: HTTPError, url: str) -> None:
        """处理 HTTP 错误。"""
        try:
            body = exc.read().decode("utf-8", errors="replace")
            error_data = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            error_data = {"raw": body[:500] if body else ""}

        message = error_data.get("message", error_data.get("detail", f"HTTP {exc.code}"))
        details = {"status_code": exc.code, "url": url, "body": error_data}

        if exc.code == 401:
            raise AuthenticationError(message=message, details=details)
        elif exc.code == 404:
            raise NotFoundError(message=message, details=details)
        elif exc.code == 422:
            raise ValidationError(message=message, details=details)
        else:
            raise AegisQAError(message=message, details=details)

    def close(self) -> None:
        """关闭客户端（当前无状态，预留接口）。"""
        pass
