import { describe, expect, it } from 'vitest';

import typesBarrelSource from '../types.ts?raw';
import type {
  AuditEvent,
  DatasetSummary,
  ModelGatewayConnection,
  ReportExportRequest,
  SkillManifest,
  TaskRecord,
  WorkflowGraph,
} from '../types';

describe('前端领域类型 barrel', () => {
  it('types.ts 只作为统一导出口，领域定义拆到 types 目录', () => {
    const expectedExports = [
      "export * from './types/common';",
      "export * from './types/dataset';",
      "export * from './types/skill';",
      "export * from './types/workflow';",
      "export * from './types/task';",
      "export * from './types/report';",
      "export * from './types/governance';",
      "export * from './types/candidate';",
      "export * from './types/experiment';",
      "export * from './types/ci';",
    ];

    for (const expectedExport of expectedExports) {
      expect(typesBarrelSource).toContain(expectedExport);
    }
    expect(typesBarrelSource.split(/\r?\n/).length).toBeLessThanOrEqual(40);
  });

  it('旧的 ../types 入口仍统一导出页面和 API 使用的关键类型', () => {
    type ExportSmoke = {
      task: TaskRecord;
      workflow: WorkflowGraph;
      skill: SkillManifest;
      dataset: DatasetSummary;
      reportExport: ReportExportRequest;
      modelConnection: ModelGatewayConnection;
      audit: AuditEvent;
    };

    const smoke = {} as ExportSmoke;
    expect(smoke).toBeDefined();
  });
});
