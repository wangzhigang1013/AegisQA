import type { SkillPackageRecord } from '../types';

/**
 * 把 Skill 包列表按 skill_id 索引成「代表记录」。
 *
 * 同一个 skill_id 在历史里可能存在多条 package 记录：被替换（replaced）/被废弃（deprecated）
 * 的旧版本仍保留在列表中。后端 `_find_skill_package`（列表按 updated_at 倒序取第一条、跳过 replaced）
 * 会把合约测试、审批结果写到「真正生效」的那条记录上。
 *
 * 这里必须与后端保持一致 —— 取「未被替换且 updated_at 最新」的那条，否则页面上展示的合约状态
 * 会指向一条被覆盖的旧记录，出现「合约测试通过但页面仍显示未通过」的假象。
 *
 * 注意：不能再用 reduce「后者覆盖前者」的写法，因为后端 list_json 按 mtime 倒序返回，
 * 数组顺序不能作为「新旧」的依据，否则旧的 replaced 记录可能排在最后而覆盖新记录。
 */
export function indexPackagesBySkillId(packages: SkillPackageRecord[]): Record<string, SkillPackageRecord> {
  return packages.reduce<Record<string, SkillPackageRecord>>((index, item) => {
    const skillId = item.manifest.skill_id;
    const current = index[skillId];
    if (!current || isMoreCanonicalPackage(item, current)) {
      index[skillId] = item;
    }
    return index;
  }, {});
}

/**
 * 判断 candidate 是否比 incumbent 更应作为该 skill_id 的代表记录：
 * 1. incumbent 已被替换（replaced）而 candidate 没有 -> candidate 优先；
 * 2. 否则按 updated_at 最新者优先（与后端 list_json 的排序语义一致）。
 */
export function isMoreCanonicalPackage(candidate: SkillPackageRecord, incumbent: SkillPackageRecord): boolean {
  const candidateReplaced = candidate.status === 'replaced';
  const incumbentReplaced = incumbent.status === 'replaced';
  if (candidateReplaced !== incumbentReplaced) {
    return !candidateReplaced;
  }
  const candidateTime = Date.parse(candidate.updated_at ?? '');
  const incumbentTime = Date.parse(incumbent.updated_at ?? '');
  return Number.isNaN(candidateTime) ? false : candidateTime > incumbentTime;
}

/** Skill 包状态 -> 中文展示。 */
export function formatSkillStatus(status: string): string {
  return {
    approved: '已启用',
    pending_review: '待审批',
    disabled: '已禁用',
    deprecated: '已废弃',
    replaced: '已替换',
  }[status] ?? status;
}
