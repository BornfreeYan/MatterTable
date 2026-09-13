import { describe, expect, it } from 'vitest';
import {
  WEEKDAYS,
  buildMonthMatrix,
  dateKeyOf,
  isValidDateKey,
  monthLabel,
  shiftMonth,
  toDateKey,
} from '../src/shared/calendar';

describe('日期键的工具函数', () => {
  it('toDateKey 用本地日期，不会因时区挪一天', () => {
    expect(toDateKey(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(toDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
    expect(toDateKey(new Date(2026, 8, 6, 23, 59, 59))).toBe('2026-09-06');
  });

  it('isValidDateKey 会挡掉不存在的日期', () => {
    expect(isValidDateKey('2026-09-06')).toBe(true);
    expect(isValidDateKey('2024-02-29')).toBe(true); // 闰年
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('2025-02-29')).toBe(false);
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('2026-9-6')).toBe(false);
    expect(isValidDateKey('2026-09-06T00:00:00Z')).toBe(false);
  });
});

describe('dateKeyOf：从单元格值里取日期', () => {
  it('普通日期字符串', () => {
    expect(dateKeyOf('2026-03-07')).toBe('2026-03-07');
    expect(dateKeyOf(' 2026-03-07 ')).toBe('2026-03-07');
  });

  it('兼容带时间的 ISO 字符串（例如 created_at）', () => {
    expect(dateKeyOf('2026-01-28T03:08:15.761075')).toBe('2026-01-28');
    expect(dateKeyOf('2026-01-28 03:08')).toBe('2026-01-28');
  });

  it('列表值取第一个有效日期', () => {
    expect(dateKeyOf(['2026-03-07', '2026-04-01'])).toBe('2026-03-07');
    expect(dateKeyOf(['不是日期', '2026-04-01'])).toBe('2026-04-01');
    expect(dateKeyOf([])).toBeNull();
  });

  it('空值与无效值返回 null', () => {
    expect(dateKeyOf(null)).toBeNull();
    expect(dateKeyOf(undefined)).toBeNull();
    expect(dateKeyOf('')).toBeNull();
    expect(dateKeyOf('待定')).toBeNull();
    expect(dateKeyOf(2026)).toBeNull();
    expect(dateKeyOf(true)).toBeNull();
    expect(dateKeyOf('2026-02-30')).toBeNull();
  });
});

describe('buildMonthMatrix：月视图矩阵', () => {
  it('固定 6 行 × 7 列，周一起始', () => {
    const weeks = buildMonthMatrix(2026, 8); // 2026 年 9 月
    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(WEEKDAYS).toHaveLength(7);
  });

  it('每行的第一天都是周一', () => {
    const weeks = buildMonthMatrix(2026, 8);
    for (const week of weeks) {
      const first = week[0];
      const date = new Date(first.key + 'T00:00:00');
      expect(date.getDay()).toBe(1);
    }
  });

  it('首行包含上月末尾、末行包含下月开头，并用 inMonth 标出', () => {
    const weeks = buildMonthMatrix(2026, 8); // 2026-09-01 是周二
    const flat = weeks.flat();
    expect(flat[0].key).toBe('2026-08-31');
    expect(flat[0].inMonth).toBe(false);
    expect(flat[1].key).toBe('2026-09-01');
    expect(flat[1].inMonth).toBe(true);
    const september = flat.filter((day) => day.inMonth);
    expect(september).toHaveLength(30);
    expect(september[0].day).toBe(1);
    expect(september[29].day).toBe(30);
  });

  it('跨年月份也正确', () => {
    const weeks = buildMonthMatrix(2026, 0); // 2026 年 1 月，1 号是周四
    const flat = weeks.flat();
    expect(flat[0].key).toBe('2025-12-29');
    expect(flat[0].inMonth).toBe(false);
    expect(flat.find((d) => d.key === '2026-01-01')?.inMonth).toBe(true);
  });

  it('闰年 2 月 29 天', () => {
    expect(buildMonthMatrix(2024, 1).flat().filter((d) => d.inMonth)).toHaveLength(29);
    expect(buildMonthMatrix(2026, 1).flat().filter((d) => d.inMonth)).toHaveLength(28);
  });
});

describe('月份切换与标题', () => {
  it('前后翻月', () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 8, 3)).toEqual({ year: 2026, month: 11 });
    expect(shiftMonth(2026, 8, -9)).toEqual({ year: 2025, month: 11 });
  });

  it('月份标题', () => {
    expect(monthLabel(2026, 8)).toBe('2026 年 9 月');
    expect(monthLabel(2026, 0)).toBe('2026 年 1 月');
  });
});
