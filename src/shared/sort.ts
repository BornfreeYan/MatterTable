import type { CellValue, ResolvedField, RowData, SortSpec } from './types';
import { FILE_COLUMN_KEY } from './types';
import { cellToText, isEmptyValue } from './values';

// 便于其他模块从本文件一并取用（main.tsx / 测试都从这里导入）
export { FILE_COLUMN_KEY };

/** 中文按拼音、数字按数值比较（1.2 < 1.10 这种按数字段比） */
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

export const fileColumnField: ResolvedField = {
  key: FILE_COLUMN_KEY,
  type: 'text',
  label: '文件名',
  storage: 'list',
  options: [],
  optionsAuto: false,
  visible: true,
  width: 220,
  order: -1,
  complex: false,
  source: 'builtin',
};

function valueOf(row: RowData, key: string): CellValue | undefined {
  if (key === FILE_COLUMN_KEY) return row.fileName;
  return row.values[key];
}

/** 单选/多选：值在选项池里的序号；未定义的值排在所有已定义选项之后 */
function optionRank(field: ResolvedField, value: string): number {
  const idx = field.options.indexOf(value);
  return idx === -1 ? field.options.length + 1 : idx;
}

/** 单选/多选里「一个值都不在选项池中」的情况：按 PRD 要求，与空值一样永远排最后 */
function isUndefinedOption(field: ResolvedField, value: CellValue | undefined): boolean {
  if (field.type !== 'select' && field.type !== 'multiSelect') return false;
  if (value === null || value === undefined) return false;
  const items = Array.isArray(value) ? value : [String(value)];
  if (items.length === 0) return false;
  return items.every((item) => !field.options.includes(item));
}

/** 非空值之间的比较：<0 / 0 / >0 */
export function compareCells(a: CellValue, b: CellValue, field: ResolvedField): number {
  switch (field.type) {
    case 'number': {
      const na = typeof a === 'number' ? a : Number(a);
      const nb = typeof b === 'number' ? b : Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb ? 0 : na < nb ? -1 : 1;
      return collator.compare(cellToText(a), cellToText(b));
    }
    case 'checkbox': {
      const va = a === true || a === 'true' ? 1 : 0;
      const vb = b === true || b === 'true' ? 1 : 0;
      return va - vb;
    }
    case 'date':
      // ISO 日期字符串按字典序比较即等价于按时间比较
      return collator.compare(cellToText(a), cellToText(b));
    case 'select': {
      const sa = cellToText(a);
      const sb = cellToText(b);
      const ra = optionRank(field, sa);
      const rb = optionRank(field, sb);
      if (ra !== rb) return ra < rb ? -1 : 1;
      return collator.compare(sa, sb);
    }
    case 'multiSelect': {
      const la = Array.isArray(a) ? a : [cellToText(a)];
      const lb = Array.isArray(b) ? b : [cellToText(b)];
      const rank = (list: string[]) => Math.min(...list.map((v) => optionRank(field, v)));
      const ra = rank(la);
      const rb = rank(lb);
      if (ra !== rb) return ra < rb ? -1 : 1;
      return collator.compare(la.join(' '), lb.join(' '));
    }
    default:
      return collator.compare(cellToText(a), cellToText(b));
  }
}

/**
 * 排序规则（按 PRD §8.3）：
 * - 空值永远排在最后，与升降序无关
 * - 单选/多选里「不在选项池中的值」同样永远排最后
 * - 排序稳定：各项相等时按文件名升序
 */
export function sortRows(
  rows: readonly RowData[],
  fieldMap: Map<string, ResolvedField>,
  sort: readonly SortSpec[],
): RowData[] {
  const specs = sort.filter((s) => s.key);
  const out = rows.slice();
  if (specs.length === 0) {
    return out.sort((ra, rb) => collator.compare(ra.fileName, rb.fileName));
  }
  out.sort((ra, rb) => {
    for (const spec of specs) {
      const field = fieldMap.get(spec.key) ?? (spec.key === FILE_COLUMN_KEY ? fileColumnField : undefined);
      if (!field) continue;
      const a = valueOf(ra, spec.key);
      const b = valueOf(rb, spec.key);
      const aLast = isEmptyValue(a ?? null) || isUndefinedOption(field, a);
      const bLast = isEmptyValue(b ?? null) || isUndefinedOption(field, b);
      if (aLast && bLast) continue;
      if (aLast) return 1;
      if (bLast) return -1;
      const cmp = compareCells(a as CellValue, b as CellValue, field);
      if (cmp !== 0) return spec.direction === 'desc' ? -cmp : cmp;
    }
    return collator.compare(ra.fileName, rb.fileName);
  });
  return out;
}
