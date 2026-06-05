import pytest

from aegisqa.models.gateway import (
    MODEL_API_KEY_ENV,
    MODEL_API_KEY_REF_ENV,
    MODEL_BASE_URL_ENV,
    MODEL_DEFAULT_ENV,
    MODEL_PROVIDER_ENV,
    MODEL_SECRET_DOTENV_ENV,
    MODEL_TIMEOUT_ENV,
    set_model_gateway_runtime_config,
    set_model_gateway_runtime_connections,
)


_MODEL_GATEWAY_ENV_NAMES = [
    MODEL_PROVIDER_ENV,
    MODEL_BASE_URL_ENV,
    MODEL_API_KEY_ENV,
    MODEL_API_KEY_REF_ENV,
    MODEL_DEFAULT_ENV,
    MODEL_TIMEOUT_ENV,
    MODEL_SECRET_DOTENV_ENV,
]


@pytest.fixture(autouse=True)
def isolate_model_gateway_runtime(monkeypatch: pytest.MonkeyPatch):
    """测试默认使用离线 mock 模型，避免本机真实模型配置污染单测。"""

    for env_name in _MODEL_GATEWAY_ENV_NAMES:
        monkeypatch.delenv(env_name, raising=False)
    set_model_gateway_runtime_config(None)
    set_model_gateway_runtime_connections([])
    yield
    set_model_gateway_runtime_config(None)
    set_model_gateway_runtime_connections([])
