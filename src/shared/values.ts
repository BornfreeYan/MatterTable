import type { CellValue } from './types';

export interface NormalizedValue {
  value: CellValue;
  /** true = 值不是标量（嵌套对象、对象数组），表格里只能只读展示 */
  complex: boolean;
}

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function formatDateValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isScalar(v: unknown): boolean {
  return v === null || v === undefined || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date;
}

/** 把单元格的值理解成「字符串列表」，用于单选/多选的比较与写入（丢掉空项） */
export function listItems(value: CellValue | undefined): string[] {
  if (value === null || value === undefined) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw.map((item) => String(item)).filter((item) => item !== '');
}

/** 单选/多选里是不是「没有任何有效选项」 */
export function isEmptyList(value: CellValue | undefined): boolean {
  return listItems(value).length === 0;
}

/** 把 YAML 解析出来的值归一化成表格用的 CellValue */
export function toCellValue(input: unknown): NormalizedValue {
  if (input === null || input === undefined) return { value: null, complex: false };
  if (typeof input === 'string') return { value: input, complex: false };
  if (typeof input === 'number') return { value: Number.isFinite(input) ? input : String(input), complex: false };
  if (typeof input === 'boolean') return { value: input, complex: false };
  if (input instanceof Date) return { value: formatDateValue(input), complex: false };
  if (Array.isArray(input)) {
    if (input.every((item) => isScalar(item))) {
      const items = input
        .map((item) => (item instanceof Date ? formatDateValue(item) : String(item ?? '')))
        .filter((item) => item !== '');
      return { value: items, complex: false };
    }
    return { value: null, complex: true };
  }
  return { value: null, complex: true };
}

export function isEmptyValue(v: CellValue | undefined | null): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** 把单元格的值转成可比较的展示字符串（用于搜索与文本排序） */
export function cellToText(v: CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(' ');
  return String(v);
}

export function cellValueEquals(a: CellValue | undefined, b: CellValue | undefined): boolean {
  if (isEmptyValue(a ?? null) && isEmptyValue(b ?? null)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => item === b[i]);
  }
  return a === b;
}
