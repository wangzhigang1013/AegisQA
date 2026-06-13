# Skill 容器化运行时指南

本文档介绍如何使用 AegisQA 的 Skill 容器化运行时，在 Docker 隔离容器中执行 Skill 插件包。

## 启用容器模式

在创建 `SubprocessPackageSkill` 时指定 `runtime_mode='container'`：

```python
from aegisqa.skills.packages import SubprocessPackageSkill

skill = SubprocessPackageSkill(
    manifest=manifest,
    handler_path=handler_path,
    package_root=package_root,
    runtime_mode="container",  # 启用容器模式
)
result = skill.run(inputs, config)
```

当 Docker 不可用时，系统会自动回退到子进程模式并记录警告日志。

## 配置选项

### 资源限制

通过 `ContainerLimits` 控制容器资源：

```python
from aegisqa.skills.container_runtime import ContainerLimits

limits = ContainerLimits(
    memory_mb=256,        # 内存限制（MB），默认 256
    cpu_quota=50000,      # CPU 配额（100000 = 1 核），默认 50000（0.5 核）
    network_disabled=True, # 禁用网络，默认 True
    read_only_root=True,   # 只读根文件系统，默认 True
)
```

### 超时设置

容器执行超时由 `timeout` 参数控制，默认 60 秒：

```python
result = runtime.run(
    image_tag="my-skill:latest",
    input_data={"inputs": {...}, "config": {...}},
    timeout=120,  # 秒
)
```

也可通过环境变量 `AEGISQA_PACKAGE_SKILL_TIMEOUT_SECONDS` 全局配置。

## 安全模型

### 网络隔离

容器默认以 `--network none` 启用，Skill 无法访问外部网络。这通过 `ContainerLimits.network_disabled` 控制。

### 只读根文件系统

容器根文件系统默认只读，防止 Skill 修改系统文件。Skill 需要写入临时文件时使用 `/tmp`（自动挂载的 tmpfs，64 MB）。

### 非 root 用户

所有 Skill 在 `skilluser`（UID 1000）用户下运行，不具有 root 权限。

### 资源限制

CPU 和内存限制防止单个 Skill 耗尽宿主机资源。超出限制的容器会被 OOM killer 终止。

## 依赖声明

在 `skill.yaml` 中声明 Skill 运行所需的 pip 依赖：

```yaml
runtime:
  mode: package
  entrypoint: handler.py:run
  dependencies:
    - "pandas>=2.0"
    - "numpy"
    - "scikit-learn"
```

构建镜像时会自动执行 `pip install`。

## 与子进程模式的对比

| 特性         | 子进程模式       | 容器模式               |
| ------------ | ---------------- | ---------------------- |
| 隔离级别     | 进程级           | 容器级                 |
| 网络隔离     | socket 拦截      | network none           |
| 文件系统隔离 | 路径检查         | 只读根 + tmpfs         |
| 资源限制     | 无               | CPU / 内存硬限制       |
| 依赖管理     | 宿主机 Python    | 镜像内独立 pip 环境    |
| 启动开销     | 低（毫秒级）     | 中（秒级，镜像构建）   |
| Docker 依赖  | 无               | 需要 Docker daemon     |

## 当前限制

1. **无镜像缓存**：每次执行都会重新构建镜像，适合开发和测试环境。生产环境建议预构建基础镜像。
2. **无漏洞扫描**：不自动扫描镜像安全漏洞，依赖人工审计或外部扫描工具。
3. **无镜像仓库集成**：镜像仅在本地构建和使用，不推送到远程仓库。
4. **无 GPU 支持**：当前不支持 GPU 资源分配。

## 故障排查

### Docker 不可用

```
ContainerRuntimeError: 无法连接到 Docker daemon
```

检查：
- Docker Desktop 或 Docker Engine 是否已启动
- 当前用户是否在 `docker` 用户组中
- `DOCKER_HOST` 环境变量是否正确

### 镜像构建失败

```
ContainerRuntimeError: 镜像构建失败
```

检查：
- `skill.yaml` 中的 `runtime.dependencies` 是否包含有效的 pip 包名
- `runtime.entrypoint` 指向的文件是否存在于插件包目录中
- 基础镜像 `aegisqa-skill-base` 是否已构建

### 容器执行超时

```
ContainerRuntimeError: 容器执行失败
```

检查：
- Skill 逻辑是否在超时时间内可完成
- 是否需要增大 `timeout` 参数
- 内存限制是否过低导致 OOM

## 未来路线图

1. **镜像缓存**：基于依赖哈希的镜像缓存层，避免重复构建。
2. **Kubernetes Jobs 支持**：将容器执行扩展到 K8s 集群，支持更大规模的并发。
3. **资源监控**：实时监控容器 CPU / 内存使用，生成资源消耗报告。
4. **镜像仓库集成**：支持推送到 Docker Hub / 私有 Registry，实现镜像复用。
5. **漏洞扫描**：集成 Trivy 等工具，在构建时自动扫描依赖漏洞。
6. **GPU 支持**：为机器学习类 Skill 分配 GPU 资源。
7. **并行执行**：支持多个容器并行执行，提升批量任务吞吐量。
