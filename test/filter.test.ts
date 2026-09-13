import { describe, expect, it } from 'vitest';
import { applyFilter, defaultCondition, describeCondition, matchesCondition, operatorsFor } from '../src/shared/filter';
import type { FilterCondition, ResolvedField, RowData, ViewFilter } from '../src/shared/types';
import { FILE_COLUMN_KEY } from '../src/shared/types';

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

function row(fileName: string, values: Record<string, RowData['values'][string]>): RowData {
  return { id: fileName, fileName, relPath: `d/${fileName}`, values, hasFrontmatter: true };
}

function cond(key: string, operator: FilterCondition['operator'], value?: FilterCondition['value']): FilterCondition {
  return { id: `${key}-${operator}`, key, operator, value };
}

const title = field({ key: 'title', type: 'text', label: '标题' });
const date = field({ key: 'date', type: 'date', label: '日期' });
const priority = field({ key: 'priority', type: 'number', label: 'priority' });
const state = field({ key: 'state', type: 'select', label: '状态', options: ['not started', 'in progress', 'finished'] });
const tags = field({ key: 'tags', type: 'multiSelect', label: '标签', options: ['CS', 'AI'] });
const published = field({ key: 'published', type: 'checkbox', label: 'published' });
const fileField = field({ key: FILE_COLUMN_KEY, type: 'text', label: '文件名', source: 'builtin' });

const fieldMap = new Map<string, ResolvedField>([
  ['title', title],
  ['date', date],
  ['priority', priority],
  ['state', state],
  ['tags', tags],
  ['published', published],
]);

const rows: RowData[] = [
  row('cs-note.md', {
    title: 'Java 面试指南',
    date: '2026-03-07',
    priority: 3,
    state: ['finished'],
    tags: ['CS', '面试'],
    published: true,
  }),
  row('ai-note.md', {
    title: 'Agent 概念',
    date: '2026-09-06',
    priority: 1,
    state: ['not started'],
    tags: ['AI'],
    published: false,
  }),
  row('empty-note.md', { title: '', date: null, priority: null, state: [], tags: [''], published: null }),
];

describe('操作符按字段类型给', () => {
  it('文本 / 数字 / 日期 / 单选 / 多选 / 复选框各有一套', () => {
    expect(operatorsFor(title).map((o) => o.op)).toEqual([
      'equals',
      'notEquals',
      'contains',
      'notContains',
      'isEmpty',
      'isNotEmpty',
    ]);
    expect(operatorsFor(priority).map((o) => o.label)).toContain('大于');
    expect(operatorsFor(date).map((o) => o.label)).toContain('早于');
    expect(operatorsFor(state).map((o) => o.op)).toEqual(['equals', 'notEquals', 'isEmpty', 'isNotEmpty']);
    expect(operatorsFor(tags).map((o) => o.label)).toEqual(['包含任一', '不包含任何', '为空', '不为空']);
    expect(operatorsFor(published).map((o) => o.op)).toEqual(['equals', 'isEmpty']);
    expect(operatorsFor(fileField).map((o) => o.op)).toContain('contains');
  });

  it('字段不存在时退回文本操作符（不报错）', () => {
    expect(operatorsFor(undefined).map((o) => o.op)).toContain('contains');
  });
});

describe('文本条件', () => {
  it('等于 / 不等于（忽略大小写）', () => {
    expect(matchesCondition(rows[0], title, cond('title', 'equals', 'java 面试指南'))).toBe(true);
    expect(matchesCondition(rows[1], title, cond('title', 'equals', 'Java 面试指南'))).toBe(false);
    expect(matchesCondition(rows[1], title, cond('title', 'notEquals', 'Java 面试指南'))).toBe(true);
  });

  it('包含 / 不包含', () => {
    expect(matchesCondition(rows[0], title, cond('title', 'contains', '面试'))).toBe(true);
    expect(matchesCondition(rows[1], title, cond('title', 'contains', '面试'))).toBe(false);
    expect(matchesCondition(rows[1], title, cond('title', 'notContains', '面试'))).toBe(true);
  });

  it('为空 / 不为空', () => {
    expect(matchesCondition(rows[2], title, cond('title', 'isEmpty'))).toBe(true);
    expect(matchesCondition(rows[0], title, cond('title', 'isEmpty'))).toBe(false);
    expect(matchesCondition(rows[0], title, cond('title', 'isNotEmpty'))).toBe(true);
  });

  it('按文件名筛选', () => {
    expect(matchesCondition(rows[0], fileField, cond(FILE_COLUMN_KEY, 'contains', 'cs-'))).toBe(true);
    expect(matchesCondition(rows[1], fileField, cond(FILE_COLUMN_KEY, 'contains', 'cs-'))).toBe(false);
  });
});

describe('数字与日期条件', () => {
  it('数字大于 / 小于 / 等于', () => {
    expect(matchesCondition(rows[0], priority, cond('priority', 'gt', 2))).toBe(true);
    expect(matchesCondition(rows[1], priority, cond('priority', 'gt', 2))).toBe(false);
    expect(matchesCondition(rows[1], priority, cond('priority', 'lt', 2))).toBe(true);
    expect(matchesCondition(rows[0], priority, cond('priority', 'equals', 3))).toBe(true);
  });

  it('日期早于 / 晚于 / 等于（ISO 字符串比较）', () => {
    expect(matchesCondition(rows[0], date, cond('date', 'lt', '2026-06-01'))).toBe(true);
    expect(matchesCondition(rows[1], date, cond('date', 'gt', '2026-06-01'))).toBe(true);
    expect(matchesCondition(rows[0], date, cond('date', 'equals', '2026-03-07'))).toBe(true);
    expect(matchesCondition(rows[2], date, cond('date', 'gt', '2026-01-01'))).toBe(false);
  });
});

describe('单选 / 多选 / 复选框条件', () => {
  it('单选等于', () => {
    expect(matchesCondition(rows[0], state, cond('state', 'equals', 'finished'))).toBe(true);
    expect(matchesCondition(rows[1], state, cond('state', 'equals', 'finished'))).toBe(false);
  });

  it('多选包含任一 / 不包含任何', () => {
    expect(matchesCondition(rows[0], tags, cond('tags', 'contains', 'CS'))).toBe(true);
    expect(matchesCondition(rows[1], tags, cond('tags', 'contains', 'CS'))).toBe(false);
    expect(matchesCondition(rows[1], tags, cond('tags', 'notContains', 'CS'))).toBe(true);
    // 部分匹配也算命中
    expect(matchesCondition(rows[0], tags, cond('tags', 'contains', '面'))).toBe(true);
  });

  it('空列表项算「为空」', () => {
    expect(matchesCondition(rows[2], tags, cond('tags', 'isEmpty'))).toBe(true);
    expect(matchesCondition(rows[2], state, cond('state', 'isEmpty'))).toBe(true);
  });

  it('复选框等于已勾选 / 未勾选，null 算未设置', () => {
    expect(matchesCondition(rows[0], published, cond('published', 'equals', true))).toBe(true);
    expect(matchesCondition(rows[1], published, cond('published', 'equals', true))).toBe(false);
    expect(matchesCondition(rows[2], published, cond('published', 'isEmpty'))).toBe(true);
  });
});

describe('组合与容错', () => {
  const filter = (logic: 'and' | 'or', conditions: FilterCondition[]): ViewFilter => ({ logic, conditions });

  it('AND：全部条件都要满足', () => {
    const result = applyFilter(rows, fieldMap, filter('and', [cond('tags', 'contains', 'CS'), cond('priority', 'gt', 2)]));
    expect(result.map((r) => r.fileName)).toEqual(['cs-note.md']);
  });

  it('OR：满足任一条件即可', () => {
    const result = applyFilter(
      rows,
      fieldMap,
      filter('or', [cond('tags', 'contains', 'CS'), cond('state', 'equals', 'not started')]),
    );
    expect(result.map((r) => r.fileName)).toEqual(['cs-note.md', 'ai-note.md']);
  });

  it('没有条件时原样返回', () => {
    expect(applyFilter(rows, fieldMap, filter('and', [])).length).toBe(3);
    expect(applyFilter(rows, fieldMap, undefined).length).toBe(3);
  });

  it('条件引用的字段不存在时不过滤任何行（不报错）', () => {
    const result = applyFilter(rows, fieldMap, filter('and', [cond('removedKey', 'equals', 'x')]));
    expect(result.length).toBe(3);
    expect(describeCondition(undefined, cond('removedKey', 'equals', 'x'))).toContain('字段已不存在');
  });

  it('条件还没填值时视为不生效', () => {
    expect(applyFilter(rows, fieldMap, filter('and', [cond('title', 'equals', '')])).length).toBe(3);
    expect(applyFilter(rows, fieldMap, filter('and', [cond('title', 'equals', null)])).length).toBe(3);
  });

  it('不修改传入的数组', () => {
    const copy = [...rows];
    applyFilter(rows, fieldMap, filter('and', [cond('title', 'isEmpty')]));
    expect(rows).toEqual(copy);
  });
});

describe('描述与默认值', () => {
  it('把条件渲染成人话', () => {
    expect(describeCondition(state, cond('state', 'equals', 'finished'))).toBe('状态 等于 finished');
    expect(describeCondition(date, cond('date', 'lt', '2026-01-01'))).toBe('日期 早于 2026-01-01');
    expect(describeCondition(title, cond('title', 'isEmpty'))).toBe('标题 为空');
    expect(describeCondition(published, cond('published', 'equals', true))).toBe('published 等于 已勾选');
  });

  it('新增条件默认取第一个操作符，且带一个合理初值', () => {
    expect(defaultCondition(title, 'x').operator).toBe('equals');
    const forState = defaultCondition(state, 'x');
    expect(forState.operator).toBe('equals');
    expect(forState.value).toBe('not started');
    expect(defaultCondition(published, 'x').value).toBe(true);
  });
});
