import { describe, expect, it } from 'vitest';

import type { SkillPackageRecord } from '../types';
import { indexPackagesBySkillId, isMoreCanonicalPackage } from '../lib/skillPackageUtils';

/**
 * 同一个 skill_id 在历史里可能存在多条 package 记录：被替换/被废弃的旧版本仍保留在列表中，
 * 后端 `_find_skill_package`（列表按 updated_at 倒序取第一条、跳过 replaced）会把合约测试结果
 * 写到最新的记录。
 *
 * indexPackagesBySkillId 必须与后端保持一致 —— 取「未被替换且 updated_at 最新」的那条，
 * 否则页面会展示一条已被覆盖的旧记录，出现「合约测试通过但页面仍显示未通过」的假象。
 */
describe('indexPackagesBySkillId 选择代表记录', () => {
  it('存在被替换的旧记录时，优先取未被替换的最新记录', () => {
    const index = indexPackagesBySkillId([
      buildRecord('plugin.echo@0.1.0', { status: 'replaced', contractOk: false, updatedAt: '2026-06-01T00:00:00+00:00' }),
      buildRecord('plugin.echo@0.1.0', { status: 'pending_review', contractOk: true, updatedAt: '2026-06-23T09:24:17+08:00' }),
    ]);
    const chosen = index['plugin.echo@0.1.0'];
    expect(chosen.status).toBe('pending_review');
    expect(chosen.last_contract_ok).toBe(true);
    expect(chosen.package_id).toBe('pkg-new');
  });

  it('多条都未替换时，取 updated_at 最新的那条（与后端 list_json 排序一致）', () => {
    const index = indexPackagesBySkillId([
      buildRecord('plugin.echo@0.1.0', { status: 'pending_review', contractOk: false, updatedAt: '2026-06-15T09:00:00+00:00' }),
      buildRecord('plugin.echo@0.1.0', { status: 'pending_review', contractOk: true, updatedAt: '2026-06-23T09:24:17+08:00' }),
      buildRecord('plugin.echo@0.1.0', { status: 'deprecated', contractOk: false, updatedAt: '2026-06-16T08:24:28+00:00' }),
    ]);
    expect(index['plugin.echo@0.1.0'].last_contract_ok).toBe(true);
  });

  it('记录顺序与后端返回顺序无关（后端按 mtime 倒序，前端不能依赖数组顺序）', () => {
    // 故意把最新记录放在数组最前，旧记录放在最后，验证不再「后者覆盖」。
    const index = indexPackagesBySkillId([
      buildRecord('plugin.echo@0.1.0', { status: 'pending_review', contractOk: true, updatedAt: '2026-06-23T09:24:17+08:00' }),
      buildRecord('plugin.echo@0.1.0', { status: 'deprecated', contractOk: false, updatedAt: '2026-06-16T08:24:28+00:00' }),
    ]);
    expect(index['plugin.echo@0.1.0'].last_contract_ok).toBe(true);
  });

  it('不同 skill_id 互不干扰', () => {
    const index = indexPackagesBySkillId([
      buildRecord('plugin.echo@0.1.0', { status: 'pending_review', contractOk: true, updatedAt: '2026-06-23T09:24:17+08:00' }),
      buildRecord('plugin.echo@0.2.0', { status: 'pending_review', contractOk: false, updatedAt: '2026-06-23T09:24:17+08:00' }),
    ]);
    expect(index['plugin.echo@0.1.0'].last_contract_ok).toBe(true);
    expect(index['plugin.echo@0.2.0'].last_contract_ok).toBe(false);
  });

  it('isMoreCanonicalPackage：被替换状态优先于时间新旧', () => {
    const replaced = buildRecord('x@1.0.0', { status: 'replaced', contractOk: false, updatedAt: '2026-06-23T09:24:17+08:00' });
    const active = buildRecord('x@1.0.0', { status: 'pending_review', contractOk: false, updatedAt: '2026-06-01T00:00:00+00:00' });
    // active 更旧，但仍应比 replaced 更 canonical。
    expect(isMoreCanonicalPackage(active, replaced)).toBe(true);
    expect(isMoreCanonicalPackage(replaced, active)).toBe(false);
  });
});

type RecordSeed = {
  status: string;
  contractOk: boolean;
  updatedAt: string;
};

function buildRecord(skillId: string, seed: RecordSeed): SkillPackageRecord {
  return {
    package_id: seed.contractOk ? 'pkg-new' : 'pkg-old',
    filename: 'package.zip',
    status: seed.status,
    manifest: {
      skill_id: skillId,
      name: 'Echo',
      version: '0.1.0',
      description: '',
      tags: [],
      scenarios: [],
      input_schema: {},
      output_schema: {},
      config_schema: {},
      cacheable: false,
      permissions: [],
      enabled: false,
      status: seed.status,
      example_input: {},
      example_config: {},
    },
    last_contract_ok: seed.contractOk,
    last_contract_result: null,
    last_contract_at: null,
    contract_history: [],
    approved_by: null,
    approved_at: null,
    approval_note: null,
    approval_history: [],
    created_at: seed.updatedAt,
    updated_at: seed.updatedAt,
  } as SkillPackageRecord;
}
