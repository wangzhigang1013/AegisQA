"""AegisQA 性能基准测试。

使用 locust 进行负载测试，验证 API 端点的性能和稳定性。

使用方法：
    # 安装 locust
    pip install locust

    # 运行测试
    locust -f tests/performance/locustfile.py --host=http://localhost:8000

    # 无 UI 模式
    locust -f tests/performance/locustfile.py --host=http://localhost:8000 --headless -u 10 -r 1 --run-time 1m
"""

from locust import HttpUser, between, task


class AegisQAUser(HttpUser):
    """模拟 AegisQA 用户行为。"""

    wait_time = between(1, 3)  # 请求间隔 1-3 秒

    def on_start(self):
        """用户启动时执行。"""
        # 获取 JWT token（如果需要）
        self.token = None
        # response = self.client.post("/auth/login", json={
        #     "username": "evaluator",
        #     "password": "evaluator123"
        # })
        # if response.status_code == 200:
        #     self.token = response.json()["access_token"]

    @task(10)
    def get_dashboard(self):
        """获取仪表盘摘要。"""
        self.client.get("/dashboard/summary")

    @task(8)
    def list_tasks(self):
        """列出任务。"""
        self.client.get("/tasks?page=1&page_size=10")

    @task(8)
    def list_runs(self):
        """列出运行。"""
        self.client.get("/runs?page=1&page_size=10")

    @task(6)
    def list_datasets(self):
        """列出数据集。"""
        self.client.get("/datasets")

    @task(6)
    def list_skills(self):
        """列出技能。"""
        self.client.get("/skills")

    @task(4)
    def list_workflows(self):
        """列出工作流。"""
        self.client.get("/workflows")

    @task(4)
    def list_experiments(self):
        """列出实验。"""
        self.client.get("/experiments")

    @task(3)
    def get_health(self):
        """健康检查。"""
        self.client.get("/healthz")

    @task(3)
    def get_metrics(self):
        """获取指标。"""
        self.client.get("/metrics/summary")

    @task(2)
    def get_audit_events(self):
        """获取审计事件。"""
        self.client.get("/audit-events")

    @task(2)
    def get_ci_gates(self):
        """获取 CI 门禁配置。"""
        self.client.get("/ci-gates")

    @task(1)
    def get_task_details(self):
        """获取任务详情（如果有任务）。"""
        response = self.client.get("/tasks?page=1&page_size=1")
        if response.status_code == 200:
            data = response.json()
            if data.get("items"):
                task_id = data["items"][0]["task_id"]
                self.client.get(f"/tasks/{task_id}")

    @task(1)
    def get_workflow_templates(self):
        """获取工作流模板。"""
        self.client.get("/workflow-templates")


class AegisQAAdminUser(HttpUser):
    """模拟管理员用户行为。"""

    wait_time = between(2, 5)  # 请求间隔 2-5 秒
    weight = 1  # 权重较低

    @task(5)
    def get_governance_status(self):
        """获取治理状态。"""
        self.client.get("/governance/runtime-status")

    @task(3)
    def get_model_gateway_status(self):
        """获取模型网关状态。"""
        self.client.get("/model-gateway/status")

    @task(2)
    def get_model_gateway_config(self):
        """获取模型网关配置。"""
        self.client.get("/model-gateway/config")

    @task(2)
    def get_skill_packages(self):
        """获取技能包列表。"""
        self.client.get("/skills/packages")

    @task(1)
    def get_annotation_queue(self):
        """获取标注队列。"""
        self.client.get("/annotation-queue")
