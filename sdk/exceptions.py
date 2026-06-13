"""AegisQA SDK 异常。"""


class AegisQAError(Exception):
    """AegisQA SDK 基础异常。"""

    def __init__(
        self,
        message: str = "AegisQA API 错误",
        details: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class AuthenticationError(AegisQAError):
    """认证失败（401）。"""


class NotFoundError(AegisQAError):
    """资源不存在（404）。"""


class ValidationError(AegisQAError):
    """请求参数校验失败（422）。"""
