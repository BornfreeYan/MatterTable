import { FILE_COLUMN_KEY } from './types';
import type { CellValue, FilterCondition, FilterOperator, ResolvedField, RowData, ViewFilter } from './types';
import { fileColumnField } from './sort';
import { cellToText, isEmptyValue, listItems } from './values';

/**
 * 筛选引擎。界面上做筛选、宿主机只负责持久化筛选条件，
 * 所以它放在 shared 里：既能被 UI 用，也能被单元测试直接跑。
 */

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

/** 文本相等判断忽略大小写与全半角差异（与「包含」的宽松程度保持一致） */
function textEquals(a: string, b: string): boolean {
  return collator.compare(a, b) === 0;
}

export type FilterValueKind = 'text' | 'number' | 'date' | 'select' | 'multiSelect' | 'checkbox';

export interface OperatorDef {
  op: FilterOperator;
  label: string;
  /** 需不需要填值（「为空 / 不为空」不需要） */
  needsValue: boolean;
  valueKind: FilterValueKind;
}

function ops(kind: FilterValueKind, list: [FilterOperator, string, boolean][]): OperatorDef[] {
  return list.map(([op, label, needsValue]) => ({ op, label, needsValue, valueKind: kind }));
}

const TEXT_OPS = ops('text', [
  ['equals', '等于', true],
  ['notEquals', '不等于', true],
  ['contains', '包含', true],
  ['notContains', '不包含', true],
  ['isEmpty', '为空', false],
  ['isNotEmpty', '不为空', false],
]);

const NUMBER_OPS = ops('number', [
  ['equals', '等于', true],
  ['notEquals', '不等于', true],
  ['gt', '大于', true],
  ['lt', '小于', true],
  ['isEmpty', '为空', false],
  ['isNotEmpty', '不为空', false],
]);

const DATE_OPS = ops('date', [
  ['equals', '等于', true],
  ['notEquals', '不等于', true],
  ['gt', '晚于', true],
  ['lt', '早于', true],
  ['isEmpty', '为空', false],
  ['isNotEmpty', '不为空', false],
]);

const SELECT_OPS = ops('select', [
  ['equals', '等于', true],
  ['notEquals', '不等于', true],
  ['isEmpty', '为空', false],
  ['isNotEmpty', '不为空', false],
]);

const MULTI_OPS = ops('multiSelect', [
  ['contains', '包含任一', true],
  ['notContains', '不包含任何', true],
  ['isEmpty', '为空', false],
  ['isNotEmpty', '不为空', false],
]);

const CHECKBOX_OPS = ops('checkbox', [
  ['equals', '等于', true],
  ['isEmpty', '未设置', false],
]);

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  equals: '等于',
  notEquals: '不等于',
  contains: '包含',
  notContains: '不包含',
  gt: '大于',
  lt: '小于',
  isEmpty: '为空',
  isNotEmpty: '不为空',
};

export function operatorsFor(field: ResolvedField | undefined): OperatorDef[] {
  if (!field) return TEXT_OPS;
  if (field.key === FILE_COLUMN_KEY) return TEXT_OPS;
  switch (field.type) {
    case 'number':
      return NUMBER_OPS;
    case 'date':
      return DATE_OPS;
    case 'select':
      return SELECT_OPS;
    case 'multiSelect':
      return MULTI_OPS;
    case 'checkbox':
      return CHECKBOX_OPS;
    default:
      return TEXT_OPS;
  }
}

export function operatorDef(field: ResolvedField | undefined, op: FilterOperator): OperatorDef {
  const list = operatorsFor(field);
  return list.find((item) => item.op === op) ?? list[0];
}

/** 某个字段被筛掉时，界面上需要提示「字段已不存在」，所以这里保留 undefined 容错 */
export function fieldFor(key: string, fieldMap: Map<string, ResolvedField>): ResolvedField | undefined {
  if (key === FILE_COLUMN_KEY) return fileColumnField;
  return fieldMap.get(key);
}

function isFieldEmpty(field: ResolvedField, value: CellValue | undefined): boolean {
  if (field.type === 'select' || field.type === 'multiSelect') return listItems(value ?? null).length === 0;
  return isEmptyValue(value ?? null);
}

function asTextList(field: ResolvedField, value: CellValue | undefined): string[] {
  if (field.type === 'multiSelect') return listItems(value ?? null);
  const text = cellToText(value ?? null);
  return text === '' ? [] : [text];
}

export function matchesCondition(
  row: RowData,
  field: ResolvedField | undefined,
  condition: FilterCondition,
): boolean {
  // 条件引用的字段不存在（例如字段被改名/删除）→ 不筛掉任何行，界面上会提示这个条件已失效
  if (!field) return true;
  const raw: CellValue | undefined = field.key === FILE_COLUMN_KEY ? row.fileName : row.values[field.key];
  const def = operatorDef(field, condition.operator);
  const wanted = condition.value;

  if (def.op === 'isEmpty') return isFieldEmpty(field, raw);
  if (def.op === 'isNotEmpty') return !isFieldEmpty(field, raw);
  if (def.needsValue && (wanted === undefined || wanted === null || wanted === '')) {
    // 条件还没填值 → 视为不生效，不筛掉任何行
    return true;
  }

  switch (def.op) {
    case 'equals':
    case 'notEquals': {
      const hit =
        def.valueKind === 'checkbox'
          ? (raw === true) === (wanted === true || wanted === 'true')
          : def.valueKind === 'number'
            ? Number(cellToText(raw)) === Number(wanted)
            : textEquals(cellToText(raw), String(wanted));
      return def.op === 'equals' ? hit : !hit;
    }
    case 'gt':
    case 'lt': {
      const a = def.valueKind === 'number' ? Number(cellToText(raw)) : cellToText(raw);
      const b = def.valueKind === 'number' ? Number(wanted) : String(wanted);
      if (typeof a === 'number' && typeof b === 'number') {
        if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
        return def.op === 'gt' ? a > b : a < b;
      }
      // 日期用 ISO 字符串比较即等价于按时间比较
      const cmp = String(a).localeCompare(String(b));
      return def.op === 'gt' ? cmp > 0 : cmp < 0;
    }
    case 'contains':
    case 'notContains': {
      const items = asTextList(field, raw);
      const needle = String(wanted).toLowerCase();
      const hit = items.some((item) => item.toLowerCase().includes(needle));
      return def.op === 'contains' ? hit : !hit;
    }
    default:
      return true;
  }
}

export function applyFilter(
  rows: readonly RowData[],
  fieldMap: Map<string, ResolvedField>,
  filter: ViewFilter | undefined,
): RowData[] {
  const conditions = (filter?.conditions ?? []).filter((c) => c && c.key);
  if (conditions.length === 0) return rows.slice();
  const logic = filter?.logic === 'or' ? 'or' : 'and';
  return rows.filter((row) => {
    const results = conditions.map((c) => matchesCondition(row, fieldFor(c.key, fieldMap), c));
    return logic === 'and' ? results.every(Boolean) : results.some(Boolean);
  });
}

/** 把条件渲染成一句人话，例如「分类 等于 CS」「日期 早于 2026-01-01」 */
export function describeCondition(field: ResolvedField | undefined, condition: FilterCondition): string {
  if (!field) return `${condition.key}（字段已不存在）`;
  const def = operatorDef(field, condition.operator);
  const label = field.label || field.key;
  if (!def.needsValue) return `${label} ${def.label}`;
  const value =
    def.valueKind === 'checkbox'
      ? condition.value === true || condition.value === 'true'
        ? '已勾选'
        : '未勾选'
      : String(condition.value ?? '');
  return `${label} ${def.label} ${value}`;
}

/** 新增条件时的默认值：取该字段第一个操作符 */
export function defaultCondition(field: ResolvedField, id: string): FilterCondition {
  const def = operatorsFor(field)[0];
  const value =
    def.valueKind === 'checkbox' ? true : def.valueKind === 'number' ? null : def.valueKind === 'select' && field.options.length > 0 ? field.options[0] : '';
  return { id, key: field.key, operator: def.op, value };
}

let counter = 0;
export function newConditionId(): string {
  counter += 1;
  return `c${Date.now().toString(36)}${counter}`;
}

/** 当前所有视图都没用到这个字段时，可以提示「这个字段没有出现在任何筛选条件里」——预留给 v3 */
export function isEmptyFilter(filter: ViewFilter | undefined): boolean {
  return (filter?.conditions ?? []).filter((c) => c && c.key).length === 0;
}

export { OPERATOR_LABELS };
