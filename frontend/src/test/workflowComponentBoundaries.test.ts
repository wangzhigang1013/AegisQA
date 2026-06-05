import { describe, expect, it } from 'vitest';

import pageSource from '../pages/WorkflowDesignerPage.tsx?raw';
import { SkillPalettePanel } from '../pages/workflowDesigner/SkillPalettePanel';
import { WorkflowCanvasPanel } from '../pages/workflowDesigner/WorkflowCanvasPanel';
import { WorkflowConsolePanel } from '../pages/workflowDesigner/WorkflowConsolePanel';
import { WorkflowDraftLoaderPanel } from '../pages/workflowDesigner/WorkflowDraftLoaderPanel';
import { WorkflowInspectorPanel } from '../pages/workflowDesigner/WorkflowInspectorPanel';

describe('Workflow 设计器组件边界', () => {
  it('主页面只编排状态，画布、Inspector、Console、Palette 和加载器拆成独立组件', () => {
    expect(WorkflowCanvasPanel).toBeTypeOf('function');
    expect(WorkflowInspectorPanel).toBeTypeOf('function');
    expect(WorkflowConsolePanel).toBeTypeOf('function');
    expect(SkillPalettePanel).toBeTypeOf('function');
    expect(WorkflowDraftLoaderPanel).toBeTypeOf('function');

    const lineCount = pageSource.split(/\r?\n/).length;
    expect(lineCount).toBeLessThanOrEqual(900);
    expect(pageSource).toContain("from './workflowDesigner/WorkflowCanvasPanel'");
    expect(pageSource).toContain("from './workflowDesigner/WorkflowInspectorPanel'");
    expect(pageSource).toContain("from './workflowDesigner/WorkflowConsolePanel'");
    expect(pageSource).toContain("from './workflowDesigner/SkillPalettePanel'");
    expect(pageSource).toContain("from './workflowDesigner/WorkflowDraftLoaderPanel'");
  });
});
