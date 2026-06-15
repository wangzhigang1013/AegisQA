# DAG 画布问题清单与优化方案

## 一、当前问题清单

### 问题 1: 节点被背景框裁切
**现象**: 节点在画布边缘时被裁切，看不到完整内容
**原因**:
- Card 组件设置了 `overflow: hidden`
- Card body 固定高度 600px，节点超出时被裁切
- ReactFlow 容器没有正确处理溢出

### 问题 2: 背景网格显示异常
**现象**: 网格点/线显示不清晰，或与节点混在一起
**原因**:
- Background 组件 z-index 设置不当
- 背景色和节点颜色对比度不够

### 问题 3: MiniMap 和 Controls 位置重叠
**现象**: 缩略图和控制按钮与节点或其他 UI 重叠
**原因**:
- 没有设置正确的定位
- 没有设置 z-index

### 问题 4: Card 标题栏占用空间
**现象**: "DAG 画布" 标题栏占用空间，减少画布可用区域
**原因**:
- Card 组件默认有 header
- 标题和操作按钮分散注意力

### 问题 5: 节点拖拽不流畅
**现象**: 拖拽节点时有卡顿
**原因**:
- CSS transition 影响性能
- 没有使用 `will-change` 优化

### 问题 6: 连线动画不明显
**现象**: 连线的动画效果看不清
**原因**:
- 动画点太小
- 颜色对比度不够

### 问题 7: 画布缩放体验差
**现象**: 缩放时中心点不对，体验不流畅
**原因**:
- 没有配置缩放中心
- 缩放范围设置不合理

---

## 二、优化方案

### Phase 1: 容器和布局修复 (优先级: 高)

#### 1.1 移除 Card 组件包装
```tsx
// 之前
<Card className="canvas-card" title="DAG 画布" extra={...}>
  <ReactFlow>...</ReactFlow>
</Card>

// 之后
<div className="canvas-container">
  <div className="canvas-toolbar">...</div>
  <ReactFlow>...</ReactFlow>
</div>
```

#### 1.2 设置正确的容器样式
```css
.canvas-container {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 600px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  background: #fafbfc;
}

.canvas-container .react-flow {
  width: 100%;
  height: 100%;
}
```

### Phase 2: 节点样式优化 (优先级: 高)

#### 2.1 设置正确的 z-index
```css
.react-flow__node {
  z-index: 10;
}

.react-flow__node.selected {
  z-index: 20;
}

.react-flow__node.dragging {
  z-index: 30;
}
```

#### 2.2 优化节点阴影
```css
.base-node {
  box-shadow: 
    0 1px 2px rgba(0, 0, 0, 0.05),
    0 2px 8px rgba(0, 0, 0, 0.08);
}

.base-node:hover {
  box-shadow: 
    0 4px 12px rgba(0, 0, 0, 0.1),
    0 8px 24px rgba(0, 0, 0, 0.08);
}
```

### Phase 3: 背景和网格优化 (优先级: 中)

#### 3.1 优化背景样式
```css
.react-flow__background {
  z-index: 0;
  opacity: 0.4;
}

.react-flow__background pattern circle {
  fill: #94a3b8;
}
```

#### 3.2 添加点状网格
```tsx
<Background
  gap={24}
  size={1.5}
  color="#94a3b8"
  variant="dots"
/>
```

### Phase 4: MiniMap 和 Controls 优化 (优先级: 中)

#### 4.1 设置正确的定位
```css
.react-flow__minimap {
  position: absolute;
  bottom: 16px;
  right: 16px;
  z-index: 100;
}

.react-flow__controls {
  position: absolute;
  bottom: 16px;
  left: 16px;
  z-index: 100;
}
```

#### 4.2 添加背景遮罩
```css
.react-flow__minimap {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
}
```

### Phase 5: 连线优化 (优先级: 中)

#### 5.1 优化连线样式
```css
.react-flow__edge-path {
  stroke: #94a3b8;
  stroke-width: 2;
}

.react-flow__edge.animated .react-flow__edge-path {
  stroke-dasharray: 5 5;
  animation: edgeAnimation 1s linear infinite;
}
```

#### 5.2 添加流动点动画
```tsx
<AnimatedEdge>
  <circle r="3" fill="#3b82f6">
    <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
  </circle>
</AnimatedEdge>
```

### Phase 6: 性能优化 (优先级: 低)

#### 6.1 使用 will-change
```css
.react-flow__node {
  will-change: transform;
}

.react-flow__edge-path {
  will-change: stroke-dashoffset;
}
```

#### 6.2 减少 transition
```css
.react-flow__node,
.react-flow__edge {
  transition: none;
}

.react-flow__node:hover,
.react-flow__edge:hover {
  transition: box-shadow 0.2s ease, stroke 0.2s ease;
}
```

---

## 三、实施步骤

### Step 1: 重构画布容器
- [ ] 移除 Card 组件包装
- [ ] 创建新的 canvas-container 组件
- [ ] 设置正确的高度和溢出

### Step 2: 修复节点样式
- [ ] 设置正确的 z-index
- [ ] 优化节点阴影
- [ ] 确保节点不被裁切

### Step 3: 优化背景网格
- [ ] 使用点状网格
- [ ] 调整颜色和透明度
- [ ] 确保网格在节点下方

### Step 4: 调整 MiniMap 和 Controls
- [ ] 设置正确的定位
- [ ] 添加 z-index
- [ ] 优化样式

### Step 5: 优化连线
- [ ] 调整连线颜色
- [ ] 优化动画效果
- [ ] 添加流动点

### Step 6: 性能优化
- [ ] 添加 will-change
- [ ] 减少不必要的 transition
- [ ] 测试大量节点性能

---

## 四、预期效果

1. ✅ 节点不再被裁切
2. ✅ 背景网格清晰可见
3. ✅ MiniMap 和 Controls 位置正确
4. ✅ 拖拽和缩放更流畅
5. ✅ 连线动画更明显
6. ✅ 整体视觉更专业
