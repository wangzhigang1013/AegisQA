# DAG 画布全面优化方案

## 一、现状分析

### 当前问题
1. **节点样式单一** - 所有节点外观相似，缺乏视觉层次
2. **连线不清晰** - 连线样式简单，难以追踪数据流向
3. **画布背景单调** - 缺乏网格参考线，节点定位困难
4. **交互反馈不足** - hover、选中、拖拽状态不明显
5. **布局混乱** - 缺乏自动对齐和网格吸附
6. **信息密度过低** - 节点内部信息展示不充分

---

## 二、业界参考

### 1. n8n (工作流自动化)
- **节点设计**: 圆角卡片 + 左侧彩色条 + 图标 + 标题 + 状态指示器
- **连线**: 贝塞尔曲线 + 动画流动效果
- **画布**: 点状网格背景 + 无限画布
- **交互**: 拖拽添加、右键菜单、快捷键

### 2. Apache Airflow (任务编排)
- **节点设计**: 矩形卡片 + 状态颜色编码 (成功/失败/运行中)
- **连线**: 直线/折线 + 箭头方向指示
- **布局**: 自动 DAG 布局 (dagre 算法)
- **信息**: 节点内显示任务类型、耗时、状态

### 3. Azure Logic Apps (云工作流)
- **节点设计**: 现代卡片 + 图标 + 连接点
- **连线**: 曲线 + 条件分支可视化
- **画布**: 浅色网格 + 缩略图导航
- **交互**: 拖拽连线、自动吸附

### 4. Figma/Blender (设计工具)
- **节点设计**: 紧凑型节点 + 端口 (Port) 系统
- **连线**: 直线/曲线 + 实时预览
- **画布**: 无限画布 + 网格对齐
- **交互**: 框选、多选、对齐分布

---

## 三、优化方案

### 3.1 节点设计 (Node Design)

#### 视觉结构
```
┌─────────────────────────────────┐
│ ▎ [图标]  节点标题              │  ← 标题栏 (左侧彩色条)
│ ▎         副标题/描述           │
├─────────────────────────────────┤
│ ▎ 输入: prompt, context         │  ← 端口区域
│ ▎ 输出: answer, score           │
├─────────────────────────────────┤
│ ▎ [状态] [耗时] [缓存]          │  ← 状态栏
└─────────────────────────────────┘
  ↑
  连接点 (Handle)
```

#### 节点类型配色方案

| 类型 | 主色 | 渐变 | 图标 | 用途 |
|------|------|------|------|------|
| Source | #0ea5e9 (天蓝) | 蓝色渐变 | 📊 Database | 数据输入 |
| Skill | #8b5cf6 (紫) | 紫色渐变 | ⚡ Function | 技能执行 |
| LLM | #3b82f6 (蓝) | 蓝紫渐变 | 🤖 Robot | 模型调用 |
| Judge | #f59e0b (橙) | 橙色渐变 | ⚖️ Scale | 质量评判 |
| Branch | #10b981 (绿) | 绿色渐变 | 🔀 Fork | 条件分支 |
| Join | #10b981 (绿) | 绿色渐变 | 🔗 Merge | 合并节点 |
| Aggregator | #6366f1 (靛蓝) | 靛蓝渐变 | 📊 Chart | 数据聚合 |
| Output | #22c55e (绿) | 绿色渐变 | ✅ Check | 结果输出 |

#### 状态指示器
```
[✓] 成功 - 绿色勾号 + 绿色边框
[⟳] 运行中 - 旋转动画 + 蓝色边框
[✗] 失败 - 红色叉号 + 红色边框
[⏸] 暂停 - 暂停图标 + 灰色边框
[○] 待执行 - 空心圆 + 默认边框
```

### 3.2 连线设计 (Edge Design)

#### 连线类型
1. **普通连线**: 实线 + 箭头
2. **条件连线**: 虚线 + 条件标签
3. **数据流连线**: 动画流动点

#### 视觉效果
```
普通连线:
○─────────────────→○

条件连线 (true/false):
○- - - - - - - - →○  [true]
○- - - - - - - - →○  [false]

数据流动画:
○──●──●──●──●──●→○  (流动点动画)
```

#### 连线样式
- **颜色**: 默认 #94a3b8 (灰色)，hover/选中时变为主题色
- **粗细**: 2px，选中时 3px
- **曲线**: 贝塞尔曲线，曲率适中
- **箭头**: 闭合箭头，大小适中

### 3.3 画布背景 (Canvas Background)

#### 网格设计
```
点状网格 (推荐):
· · · · · · · · ·
· · · · · · · · ·
· · · · · · · · ·

线条网格:
┌───┬───┬───┬───┐
├───┼───┼───┼───┤
├───┼───┼───┼───┤
└───┴───┴───┴───┘
```

#### 配色
- **背景**: #fafbfc (浅灰白)
- **网格点/线**: #e2e8f0 (浅灰)
- **网格间距**: 20px (小) / 40px (大)

### 3.4 交互设计 (Interaction Design)

#### 状态反馈
| 状态 | 视觉效果 |
|------|----------|
| **默认** | 基础阴影 + 默认边框 |
| **Hover** | 上浮 2px + 发光阴影 + 边框变色 |
| **选中** | 蓝色边框 + 外发光 + 顶部彩色条 |
| **拖拽** | 半透明 + 放大 1.02x + 抓取光标 |
| **连接中** | 连接点放大 + 高亮可连接节点 |

#### 快捷操作
- **双击节点**: 打开配置面板
- **右键菜单**: 复制、删除、禁用、查看详情
- **拖拽连线**: 从端口拖出创建连接
- **框选**: 按住 Shift 框选多个节点
- **Delete/Backspace**: 删除选中元素
- **Ctrl+Z/Y**: 撤销/重做

### 3.5 布局系统 (Layout System)

#### 自动布局算法
使用 **dagre** 或 **ELK.js** 实现自动 DAG 布局:

```javascript
// dagre 布局配置
const layoutConfig = {
  rankdir: 'TB',      // 从上到下
  nodesep: 80,        // 节点水平间距
  ranksep: 120,       // 节点垂直间距
  marginx: 40,        // 画布边距
  marginy: 40,
};
```

#### 网格吸附
- 节点移动时吸附到 20px 网格
- 连线端点自动对齐
- 支持分布对齐 (水平/垂直等距)

### 3.6 信息展示 (Information Display)

#### 节点内部信息
```
┌─────────────────────────────────┐
│ ⚡ LLM Call                     │  ← 标题 + 类型图标
│ gpt-4-turbo                     │  ← 模型/配置信息
├─────────────────────────────────┤
│ in: prompt, context             │  ← 输入端口
│ out: answer, tokens             │  ← 输出端口
├─────────────────────────────────┤
│ ✓ 1.2s | 1.5k tokens | cached  │  ← 执行状态
└─────────────────────────────────┘
```

#### 悬浮提示 (Tooltip)
- 节点完整配置
- 最近执行结果
- 错误信息 (如果有)
- 快捷操作按钮

---

## 四、实现计划

### Phase 1: 基础样式优化 (1-2天)
- [x] 更新 CSS 变量系统
- [x] 优化节点卡片样式
- [x] 优化连线样式
- [x] 添加画布背景网格
- [ ] 安装 dagre 依赖

### Phase 2: 自定义节点组件 (2-3天)
- [ ] 创建 CustomNode 组件
- [ ] 实现节点类型配色
- [ ] 添加状态指示器
- [ ] 实现端口 (Port) 系统
- [ ] 添加节点内部信息展示

### Phase 3: 连线增强 (1-2天)
- [ ] 实现贝塞尔曲线连线
- [ ] 添加连线动画效果
- [ ] 实现条件分支标签
- [ ] 优化连线交互

### Phase 4: 布局系统 (2-3天)
- [ ] 集成 dagre 布局算法
- [ ] 实现自动布局功能
- [ ] 添加网格吸附
- [ ] 实现对齐分布

### Phase 5: 交互优化 (2-3天)
- [ ] 实现右键菜单
- [ ] 添加框选功能
- [ ] 优化拖拽体验
- [ ] 完善快捷键

### Phase 6: 性能优化 (1-2天)
- [ ] 节点虚拟化 (大量节点)
- [ ] 连线批量渲染
- [ ] 防抖优化
- [ ] 内存优化

---

## 五、技术实现

### 5.1 依赖安装

```bash
cd frontend
npm install dagre @types/dagre
```

### 5.2 核心组件结构

```
frontend/src/pages/workflowDesigner/
├── CustomNodes/
│   ├── BaseNode.tsx          # 基础节点组件
│   ├── SkillNode.tsx         # Skill 节点
│   ├── SourceNode.tsx        # 数据源节点
│   ├── OutputNode.tsx        # 输出节点
│   ├── BranchNode.tsx        # 分支节点
│   └── index.ts              # 导出
├── CustomEdges/
│   ├── AnimatedEdge.tsx      # 动画连线
│   ├── ConditionalEdge.tsx   # 条件连线
│   └── index.ts
├── Canvas/
│   ├── CanvasBackground.tsx  # 画布背景
│   ├── CanvasControls.tsx    # 画布控制
│   ├── CanvasMinimap.tsx     # 缩略图
│   └── ContextMenu.tsx       # 右键菜单
├── Layout/
│   ├── dagreLayout.ts        # dagre 布局
│   └── autoLayout.ts         # 自动布局逻辑
└── WorkflowCanvasPanel.tsx   # 主画布组件
```

### 5.3 关键代码示例

#### BaseNode 组件
```tsx
// BaseNode.tsx
import { Handle, Position } from '@xyflow/react';
import { memo } from 'react';

interface BaseNodeProps {
  data: {
    label: string;
    type: string;
    status?: 'idle' | 'running' | 'success' | 'error';
    icon: React.ReactNode;
    color: string;
    inputs?: string[];
    outputs?: string[];
  };
  selected?: boolean;
}

export const BaseNode = memo(({ data, selected }: BaseNodeProps) => {
  const statusColors = {
    idle: '#94a3b8',
    running: '#3b82f6',
    success: '#22c55e',
    error: '#ef4444',
  };

  return (
    <div className={`base-node ${selected ? 'selected' : ''}`}>
      {/* 左侧彩色条 */}
      <div className="node-accent" style={{ background: data.color }} />

      {/* 输入端口 */}
      {data.inputs?.map((input, i) => (
        <Handle
          key={input}
          type="target"
          position={Position.Left}
          id={input}
          style={{ top: `${30 + i * 24}px` }}
        />
      ))}

      {/* 节点内容 */}
      <div className="node-content">
        <div className="node-header">
          <span className="node-icon">{data.icon}</span>
          <span className="node-title">{data.label}</span>
        </div>

        {/* 状态指示器 */}
        {data.status && (
          <div className="node-status" style={{ color: statusColors[data.status] }}>
            {data.status === 'running' && <span className="spinner" />}
            {data.status}
          </div>
        )}
      </div>

      {/* 输出端口 */}
      {data.outputs?.map((output, i) => (
        <Handle
          key={output}
          type="source"
          position={Position.Right}
          id={output}
          style={{ top: `${30 + i * 24}px` }}
        />
      ))}
    </div>
  );
});
```

#### dagre 布局
```typescript
// dagreLayout.ts
import dagre from 'dagre';

interface LayoutOptions {
  direction?: 'TB' | 'LR';
  nodeWidth?: number;
  nodeHeight?: number;
  ranksep?: number;
  nodesep?: number;
}

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
) {
  const {
    direction = 'TB',
    nodeWidth = 200,
    nodeHeight = 100,
    ranksep = 100,
    nodesep = 60,
  } = options;

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, ranksep, nodesep });

  // 添加节点
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  // 添加边
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // 执行布局
  dagre.layout(dagreGraph);

  // 应用位置
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
```

---

## 六、预期效果

### 视觉效果
- ✅ 现代感十足的节点设计
- ✅ 清晰的数据流向可视化
- ✅ 专业的状态指示系统
- ✅ 流畅的交互动画

### 用户体验
- ✅ 直观的节点拖拽和连接
- ✅ 便捷的自动布局功能
- ✅ 清晰的错误和状态反馈
- ✅ 高效的快捷键操作

### 性能表现
- ✅ 流畅的画布缩放和平移
- ✅ 快速的节点渲染
- ✅ 低内存占用

---

## 七、参考资料

1. [React Flow 官方文档](https://reactflow.dev/)
2. [dagre 布局算法](https://github.com/dagrejs/dagre)
3. [n8n 工作流编辑器](https://n8n.io/)
4. [Apache Airflow UI](https://airflow.apache.org/)
5. [Azure Logic Apps 设计器](https://azure.microsoft.com/en-us/products/logic-apps/)
