"""AegisQA Python SDK。

让外部程序可以调用 AegisQA 平台 API。

使用方式：
    from aegisqa_sdk import AegisQA

    client = AegisQA(base_url="http://localhost:8000")

    # 列出所有 Skill
    skills = client.skills.list()

    # 创建任务
    task = client.tasks.create(
        name="my-task",
        dataset_id="my-dataset",
        workflow_id="my-workflow",
    )

    # 导出 Skill 包
    export = client.skills.export("my-skill@0.1.0")

CLI 使用方式：
    aegisqa skill list
    aegisqa task list
    aegisqa report <task-id>
"""

from .client import AegisQA
from .exceptions import AegisQAError, AuthenticationError, NotFoundError, ValidationError

__version__ = "0.1.0"
__all__ = ["AegisQA", "AegisQAError", "AuthenticationError", "NotFoundError", "ValidationError"]
