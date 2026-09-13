import { describe, expect, it } from 'vitest';
import { FILE_COLUMN_KEY, fileColumnField, sortRows } from '../src/shared/sort';
import type { CellValue, ResolvedField, RowData } from '../src/shared/types';

function field(partial: Partial<ResolvedField> & { key: string; type: ResolvedField['type'] }): ResolvedField {
  return {
    label: partial.key,
    storage: 'list',
    options: [],
    optionsAuto: false,
    visible: true,
    width: 160,
    order: 0,
    complex: false,
    source: 'config',
    ...partial,
  };
}

function row(fileName: string, values: Record<string, CellValue>): RowData {
  return { id: fileName, fileName, relPath: `dir/${fileName}`, values, hasFrontmatter: true };
}

const fields = new Map<string, ResolvedField>([
  ['title', field({ key: 'title', type: 'text' })],
  ['date', field({ key: 'date', type: 'date' })],
  ['state', field({ key: 'state', type: 'select', options: ['not started', 'in progress', 'finished'] })],
  ['tags', field({ key: 'tags', type: 'multiSelect', options: ['CS', 'AI', 'English'] })],
  ['priority', field({ key: 'priority', type: 'number' })],
  ['published', field({ key: 'published', type: 'checkbox' })],
  [FILE_COLUMN_KEY, fileColumnField],
]);

function names(rows: RowData[]): string[] {
  return rows.map((r) => r.fileName);
}

describe('文本排序', () => {
  const rows = [
    row('b.md', { title: 'Banana' }),
    row('a.md', { title: 'apple' }),
    row('c.md', { title: 'Cherry' }),
  ];

  it('升序 / 降序', () => {
    expect(names(sortRows(rows, fields, [{ key: 'title', direction: 'asc' }]))).toEqual(['a.md', 'b.md', 'c.md']);
    expect(names(sortRows(rows, fields, [{ key: 'title', direction: 'desc' }]))).toEqual(['c.md', 'b.md', 'a.md']);
  });

  it('空值永远排最后（与方向无关）', () => {
    const withEmpty = [row('a.md', { title: null }), row('b.md', { title: 'z' }), row('c.md', { title: 'a' })];
    expect(names(sortRows(withEmpty, fields, [{ key: 'title', direction: 'asc' }]))).toEqual(['c.md', 'b.md', 'a.md']);
    expect(names(sortRows(withEmpty, fields, [{ key: 'title', direction: 'desc' }]))).toEqual(['b.md', 'c.md', 'a.md']);
  });

  it('中文按拼音排序', () => {
    const cn = [row('a.md', { title: '支付宝' }), row('b.md', { title: '百度' }), row('c.md', { title: '安' })];
    expect(names(sortRows(cn, fields, [{ key: 'title', direction: 'asc' }]))).toEqual(['c.md', 'b.md', 'a.md']);
  });
});

describe('日期排序', () => {
  const rows = [
    row('a.md', { date: '2026-03-07' }),
    row('b.md', { date: '2025-12-31' }),
    row('c.md', { date: '2026-09-13' }),
    row('d.md', { date: null }),
  ];

  it('按时间先后', () => {
    expect(names(sortRows(rows, fields, [{ key: 'date', direction: 'asc' }]))).toEqual(['b.md', 'a.md', 'c.md', 'd.md']);
    expect(names(sortRows(rows, fields, [{ key: 'date', direction: 'desc' }]))).toEqual(['c.md', 'a.md', 'b.md', 'd.md']);
  });
});

describe('单选按选项池顺序排序', () => {
  const rows = [
    row('a.md', { state: ['finished'] }),
    row('b.md', { state: ['not started'] }),
    row('c.md', { state: ['in progress'] }),
    row('d.md', { state: ['不存在的值'] }),
    row('e.md', { state: [] }),
  ];

  it('按选项顺序升序：not started → in progress → finished', () => {
    expect(names(sortRows(rows, fields, [{ key: 'state', direction: 'asc' }]))).toEqual([
      'b.md',
      'c.md',
      'a.md',
      'd.md',
      'e.md',
    ]);
  });

  it('降序把已定义选项反过来，未定义与空仍排最后', () => {
    expect(names(sortRows(rows, fields, [{ key: 'state', direction: 'desc' }]))).toEqual([
      'a.md',
      'c.md',
      'b.md',
      'd.md',
      'e.md',
    ]);
  });
});

describe('多选排序', () => {
  const rows = [
    row('a.md', { tags: ['English'] }),
    row('b.md', { tags: ['CS', 'AI'] }),
    row('c.md', { tags: ['AI'] }),
    row('d.md', { tags: [] }),
  ];

  it('取选项池里序号最小的值参与比较', () => {
    expect(names(sortRows(rows, fields, [{ key: 'tags', direction: 'asc' }]))).toEqual(['b.md', 'c.md', 'a.md', 'd.md']);
  });
});

describe('数字与复选框排序', () => {
  it('数字按大小而不是字典序', () => {
    const rows = [row('a.md', { priority: 10 }), row('b.md', { priority: 2 }), row('c.md', { priority: 1 })];
    expect(names(sortRows(rows, fields, [{ key: 'priority', direction: 'asc' }]))).toEqual(['c.md', 'b.md', 'a.md']);
  });

  it('复选框：未勾在前', () => {
    const rows = [
      row('a.md', { published: true }),
      row('b.md', { published: false }),
      row('c.md', { published: null }),
    ];
    expect(names(sortRows(rows, fields, [{ key: 'published', direction: 'asc' }]))).toEqual(['b.md', 'a.md', 'c.md']);
  });
});

describe('稳定性与文件名排序', () => {
  it('没有排序规则时按文件名升序', () => {
    const rows = [row('c.md', {}), row('a.md', {}), row('b.md', {})];
    expect(names(sortRows(rows, fields, []))).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('并列时按文件名决定先后（结果稳定）', () => {
    const rows = [
      row('z.md', { state: ['finished'] }),
      row('a.md', { state: ['finished'] }),
      row('m.md', { state: ['finished'] }),
    ];
    expect(names(sortRows(rows, fields, [{ key: 'state', direction: 'asc' }]))).toEqual(['a.md', 'm.md', 'z.md']);
  });

  it('按文件名列排序', () => {
    const rows = [row('3.md', {}), row('1.md', {}), row('2.md', {})];
    expect(names(sortRows(rows, fields, [{ key: FILE_COLUMN_KEY, direction: 'asc' }]))).toEqual([
      '1.md',
      '2.md',
      '3.md',
    ]);
    expect(names(sortRows(rows, fields, [{ key: FILE_COLUMN_KEY, direction: 'desc' }]))).toEqual([
      '3.md',
      '2.md',
      '1.md',
    ]);
  });

  it('排序不会修改传入的数组', () => {
    const rows = [row('b.md', {}), row('a.md', {})];
    const copy = [...rows];
    sortRows(rows, fields, [{ key: 'title', direction: 'asc' }]);
    expect(rows).toEqual(copy);
  });
});
