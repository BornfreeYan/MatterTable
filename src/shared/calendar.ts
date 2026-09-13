import type { CellValue } from './types';

/**
 * 日历视图用的日期工具。
 * 全部按「本地日期」处理：只认 YYYY-MM-DD，避免时区把日期挪一天。
 */

export const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isValidDateKey(value: string): boolean {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!matched) return false;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // 用 Date 反查一次，排除 2 月 30 日这类不存在的日期
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * 从单元格值里取出一个 YYYY-MM-DD：
 * 兼容 `2026-01-28T03:08:15` 这种带时间的字符串，以及列表值（取第一个有效日期）。
 */
export function dateKeyOf(value: CellValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  const candidates = Array.isArray(value) ? value : [value];
  for (const item of candidates) {
    const text = String(item).trim();
    const matched = /^(\d{4}-\d{2}-\d{2})/.exec(text);
    if (matched && isValidDateKey(matched[1])) return matched[1];
  }
  return null;
}

export interface CalendarDay {
  /** YYYY-MM-DD */
  key: string;
  day: number;
  inMonth: boolean;
}

/**
 * 月视图矩阵：周一起始、固定 6 行 × 7 列。
 * 固定 6 行是为了让不同月份切换时高度不跳动。
 */
export function buildMonthMatrix(year: number, month: number): CalendarDay[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // 周一 = 0
  const weeks: CalendarDay[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(year, month, 1 - offset + w * 7 + d);
      week.push({ key: toDateKey(date), day: date.getDate(), inMonth: date.getMonth() === month });
    }
    weeks.push(week);
  }
  return weeks;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const date = new Date(year, month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function monthLabel(year: number, month: number): string {
  return `${year} 年 ${month + 1} 月`;
}
