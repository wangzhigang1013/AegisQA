# AegisQA 项目规则

## 开发工作流规则

### 自动重启规则
**当修改以下类型的代码后，必须自动重启前后端服务：**

1. **需要重启的代码类型**
   - Python 后端代码 (`aegisqa/**/*.py`)
   - 前端代码 (`frontend/src/**/*.tsx`, `frontend/src/**/*.ts`, `frontend/src/**/*.css`)
   - 配置文件 (`*.json`, `*.yaml`, `*.yml`)
   - 样式文件 (`*.css`, `*.less`, `*.scss`)

2. **重启命令 (Windows)**
   ```bash
   # 停止所有服务
   taskkill //F //IM python.exe 2>/dev/null
   taskkill //F //IM node.exe 2>/dev/null
   sleep 2

   # 启动后端 (从项目根目录)
   cd C:/Users/17343/Desktop/AegisQA
   python -m uvicorn aegisqa.api.app:app --reload --host 127.0.0.1 --port 8000 &

   # 启动前端
   cd frontend && npm run dev &
   ```

3. **重启命令 (Linux/Mac)**
   ```bash
   # 停止所有服务
   pkill -f "uvicorn aegisqa.api.app:app" 2>/dev/null
   pkill -f "npm run dev" 2>/dev/null
   sleep 2

   # 启动后端 (从项目根目录)
   python -m uvicorn aegisqa.api.app:app --reload --host 127.0.0.1 --port 8000 &

   # 启动前端
   cd frontend && npm run dev &
   ```

4. **验证步骤**
   - 检查后端: `curl -s http://localhost:8000/health`
   - 检查前端: `curl -s http://localhost:5173 | head -1`

### 重要说明
- **每次修改代码后都必须重启服务**，确保更改生效
- 后端使用 `--reload` 参数，但为确保稳定性，建议手动重启
- 前端使用 Vite 热重载，但修改组件或样式后建议重启以确保状态清除
- 重启后等待 5 秒再验证服务状态
