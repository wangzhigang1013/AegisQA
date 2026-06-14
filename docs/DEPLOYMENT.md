# AegisQA 部署指南

## 目录

- [环境要求](#环境要求)
- [快速部署](#快速部署)
- [生产部署](#生产部署)
- [配置说明](#配置说明)
- [监控与告警](#监控与告警)
- [备份与恢复](#备份与恢复)
- [故障排查](#故障排查)

## 环境要求

### 最低要求

- **CPU**: 2 核
- **内存**: 4 GB
- **磁盘**: 20 GB
- **操作系统**: Linux (Ubuntu 20.04+, CentOS 7+) 或 Docker

### 推荐配置

- **CPU**: 4 核
- **内存**: 8 GB
- **磁盘**: 50 GB SSD
- **操作系统**: Ubuntu 22.04 LTS

### 软件依赖

- Python 3.11+
- Node.js 18+ (前端构建)
- MySQL 8.0+ (可选，生产环境推荐)
- Redis 7.0+ (可选，用于缓存和分布式锁)
- Docker 20.10+ (容器化部署)

## 快速部署

### 使用 Docker Compose（推荐）

```bash
# 1. 克隆代码
git clone https://github.com/wangzhigang1013/AegisQA.git
cd AegisQA

# 2. 复制环境变量
cp .env.example .env
# 编辑 .env 文件，修改敏感配置

# 3. 启动服务
docker-compose up -d

# 4. 访问服务
# 前端: http://localhost:5173
# 后端 API: http://localhost:8000
# API 文档: http://localhost:8000/docs
```

### 手动部署

```bash
# 1. 克隆代码
git clone https://github.com/wangzhigang1013/AegisQA.git
cd AegisQA

# 2. 创建虚拟环境
python -m venv venv
source venv/bin/activate  # Linux/macOS
# venv\Scripts\activate  # Windows

# 3. 安装依赖
pip install -e .

# 4. 构建前端
cd frontend
npm install
npm run build
cd ..

# 5. 启动后端
python -m uvicorn aegisqa.api.app:app --host 0.0.0.0 --port 8000

# 6. 访问服务
# 前端: http://localhost:5173 (开发模式) 或 http://localhost:8000 (生产模式)
# API 文档: http://localhost:8000/docs
```

## 生产部署

### 使用 Docker

```bash
# 1. 构建镜像
docker build -t aegisqa:latest .

# 2. 运行容器
docker run -d \
  --name aegisqa \
  -p 8000:8000 \
  -v /data/aegisqa_store:/data/aegisqa_store \
  -e AEGISQA_STORAGE_BACKEND=mysql \
  -e AEGISQA_MYSQL_HOST=your-mysql-host \
  -e AEGISQA_MYSQL_PASSWORD=your-mysql-password \
  -e AEGISQA_JWT_SECRET=your-jwt-secret \
  aegisqa:latest
```

### 使用 Kubernetes

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aegisqa
spec:
  replicas: 3
  selector:
    matchLabels:
      app: aegisqa
  template:
    metadata:
      labels:
        app: aegisqa
    spec:
      containers:
        - name: aegisqa
          image: aegisqa:latest
          ports:
            - containerPort: 8000
          env:
            - name: AEGISQA_STORAGE_BACKEND
              value: "mysql"
            - name: AEGISQA_MYSQL_HOST
              valueFrom:
                secretKeyRef:
                  name: aegisqa-secrets
                  key: mysql-host
            - name: AEGISQA_JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: aegisqa-secrets
                  key: jwt-secret
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8000
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8000
            initialDelaySeconds: 5
            periodSeconds: 5
          volumeMounts:
            - name: data
              mountPath: /data/aegisqa_store
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: aegisqa-data
```

## 配置说明

### 存储后端

| 后端 | 适用场景 | 优点 | 缺点 |
|------|----------|------|------|
| JSON | 开发/测试 | 简单、无需额外服务 | 不支持并发写入 |
| SQLite | 单机部署 | 轻量、支持并发 | 不支持多进程 |
| MySQL | 生产部署 | 高并发、支持集群 | 需要额外服务 |

### 模型网关配置

```bash
# OpenAI
AEGISQA_MODEL_PROVIDER=openai
AEGISQA_MODEL_BASE_URL=https://api.openai.com/v1
AEGISQA_MODEL_API_KEY=sk-your-api-key
AEGISQA_MODEL_DEFAULT=gpt-4

# Anthropic
AEGISQA_MODEL_PROVIDER=anthropic
AEGISQA_MODEL_API_KEY=sk-ant-your-api-key
AEGISQA_MODEL_DEFAULT=claude-3-opus-20240229

# 自定义兼容 API
AEGISQA_MODEL_PROVIDER=openai_compatible
AEGISQA_MODEL_BASE_URL=https://your-api.com/v1
AEGISQA_MODEL_API_KEY=your-api-key
AEGISQA_MODEL_DEFAULT=your-model-name
```

## 监控与告警

### Prometheus 指标

访问 `/metrics` 端点获取 Prometheus 格式指标：

```bash
curl http://localhost:8000/metrics
```

主要指标：
- `http_requests_total`: HTTP 请求总数
- `http_request_duration_seconds`: 请求延迟
- `model_tokens_total`: 模型 token 使用量
- `skill_executions_total`: Skill 执行统计

### 健康检查

访问 `/healthz` 端点检查服务健康状态：

```bash
curl http://localhost:8000/healthz
```

返回示例：
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00Z",
  "checks": {
    "database": {"status": "ok", "backend": "mysql"},
    "disk": {"status": "ok", "free_gb": 50.0},
    "storage": {"status": "ok", "backend": "mysql"}
  },
  "version": "0.2.0"
}
```

### 日志

日志默认输出为 JSON 格式，便于 ELK/Loki 等日志系统解析：

```json
{
  "timestamp": "2024-01-01T00:00:00Z",
  "level": "INFO",
  "logger": "aegisqa.api.access",
  "message": "GET /api/tasks 200 15.2ms trace=trace_abc123",
  "module": "app",
  "function": "request_id_middleware",
  "line": 538
}
```

## 备份与恢复

### MySQL 备份

```bash
# 备份
mysqldump -u aegisqa -p aegisqa > backup_$(date +%Y%m%d).sql

# 恢复
mysql -u aegisqa -p aegisqa < backup_20240101.sql
```

### 文件备份

```bash
# 备份数据目录
tar -czf aegisqa_backup_$(date +%Y%m%d).tar.gz /data/aegisqa_store

# 恢复
tar -xzf aegisqa_backup_20240101.tar.gz -C /
```

## 故障排查

### 服务无法启动

1. 检查端口是否被占用：`lsof -i :8000`
2. 检查环境变量是否正确配置
3. 检查数据库连接是否正常
4. 查看日志：`docker logs aegisqa` 或 `journalctl -u aegisqa`

### 数据库连接失败

1. 检查 MySQL 服务是否运行：`systemctl status mysql`
2. 检查连接参数是否正确
3. 检查防火墙设置
4. 检查 MySQL 用户权限

### 性能问题

1. 检查系统资源：`top`, `df -h`, `free -h`
2. 检查慢查询日志
3. 检查 Redis 连接状态
4. 查看 Prometheus 指标

### API 响应慢

1. 检查网络延迟
2. 检查数据库查询性能
3. 检查模型 API 响应时间
4. 查看请求追踪信息
