# ============================================
# 多阶段构建 - 生产级 Dockerfile
# ============================================

# 阶段 1: 构建阶段
FROM python:3.12-slim as builder

# 设置工作目录
WORKDIR /app

# 安装构建依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY pyproject.toml ./
COPY aegisqa/ ./aegisqa/

# 安装 Python 依赖
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --prefix=/install .

# 阶段 2: 运行阶段
FROM python:3.12-slim as runtime

# 设置环境变量
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    AEGISQA_STORE_ROOT=/data/aegisqa_store \
    AEGISQA_STORAGE_BACKEND=json \
    AEGISQA_LOG_LEVEL=INFO \
    AEGISQA_LOG_FORMAT=json

# 安装运行时依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 创建非 root 用户
RUN groupadd -r aegisqa && useradd -r -g aegisqa -d /app -s /sbin/nologin aegisqa

# 创建数据目录
RUN mkdir -p /data/aegisqa_store && chown -R aegisqa:aegisqa /data

# 从构建阶段复制安装的包
COPY --from=builder /install /usr/local

# 设置工作目录
WORKDIR /app

# 复制应用代码
COPY . .

# 创建前端构建目录（如果存在）
RUN if [ -d "frontend/dist" ]; then \
    mkdir -p /app/static && \
    cp -r frontend/dist/* /app/static/; \
    fi

# 切换到非 root 用户
USER aegisqa

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/healthz || exit 1

# 暴露端口
EXPOSE 8000

# 启动命令
CMD ["python", "-m", "uvicorn", "aegisqa.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
