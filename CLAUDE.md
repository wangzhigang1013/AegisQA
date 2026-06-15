# AegisQA 项目规则

## 开发工作流规则

### 自动重启规则
**当修改以下类型的后端代码后，必须自动重启前后端服务：**

1. **Python 后端代码** (`aegisqa/**/*.py`)
   - API 路由 (`aegisqa/api/routes/*.py`)
   - 核心业务逻辑 (`aegisqa/core/`, `aegisqa/engine/`, `aegisqa/skills/` 等)
   - 数据模型 (`aegisqa/models/`)
   - 存储层 (`aegisqa/storage/`)

2. **重启命令**
   ```bash
   # 停止服务
   pkill -f "uvicorn aegisqa.api.app:app" 2>/dev/null
   pkill -f "npm run dev" 2>/dev/null
   sleep 2

   # 启动后端
   cd C:/Users/wy_wangZhiGang1/Desktop/AgeisQA
   python -m uvicorn aegisqa.api.app:app --reload --host 127.0.0.1 --port 8000 &

   # 启动前端
   cd frontend && npm run dev &
   ```

3. **验证步骤**
   - 检查后端: `curl -s http://127.0.0.1:8000/health`
   - 检查前端: `curl -s http://127.0.0.1:5173 | head -1`

### 不需要重启的情况
- 仅修改前端代码 (`frontend/src/**/*.tsx`, `frontend/src/**/*.ts`)
- 仅修改文档 (`docs/**/*.md`)
- 仅修改测试文件 (`tests/**/*.py`)

### 注意事项
- 后端使用 `--reload` 参数，理论上会自动重载，但为确保稳定性，建议手动重启
- 前端使用 Vite 热重载，修改前端代码会自动更新，无需重启
