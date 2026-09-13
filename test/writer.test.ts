import { describe, expect, it } from 'vitest';
import {
  WriteError,
  addSkeleton,
  findField,
  inspect,
  parseKeyLine,
  quoteScalar,
  removeFieldValue,
  setFieldValue,
} from '../src/extension/writer';

const CRLF = '\r\n';
const BOM = '\ufeff';

/** 用 PRD 里的真实笔记形态做基准文件：CRLF、无 BOM、含带引号日期与块状列表 */
const sampleLf = [
  '---',
  'title: Agent Concepts Introduction',
  "date: '2026-03-07'",
  'categories:',
  '  - AI',
  'tags:',
  '  - Agent',
  '  - 工程纪律',
  'state:',
  '  - not started',
  '---',
  '',
  '正文第一行',
  '正文第二行',
  '',
].join('\n');

const sampleCrlf = sampleLf.replace(/\n/g, CRLF);

/** 断言：只有指定的行发生了变化，其余行逐字节一致 */
function changedLines(before: string, after: string): number[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const changed: number[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) changed.push(i);
  }
  return changed;
}

/**
 * 最强的保真断言：before 里的 beforeNeedle 被替换成 afterNeedle，
 * 其余部分（前后所有字节）必须完全一致。
 */
function expectRegionReplaced(before: string, after: string, beforeNeedle: string, afterNeedle: string): void {
  const i = before.indexOf(beforeNeedle);
  expect(i, `原文件中找不到待替换片段：${JSON.stringify(beforeNeedle)}`).toBeGreaterThanOrEqual(0);
  if (afterNeedle === '') {
    // 纯删除：删除后剩余部分必须与原文件去掉该片段后完全一致
    expect(after).toBe(before.slice(0, i) + before.slice(i + beforeNeedle.length));
    return;
  }
  const j = after.indexOf(afterNeedle);
  expect(j, `结果文件中找不到替换后片段：${JSON.stringify(afterNeedle)}`).toBeGreaterThanOrEqual(0);
  expect(after.slice(0, j)).toBe(before.slice(0, i));
  expect(after.slice(j + afterNeedle.length)).toBe(before.slice(i + beforeNeedle.length));
}

describe('inspect', () => {
  it('识别 front matter 与换行风格', () => {
    const b = inspect(sampleLf);
    expect(b.hasFrontmatter).toBe(true);
    expect(b.parseError).toBeUndefined();
    expect(b.eol).toBe('\n');
    expect(b.data?.title).toBe('Agent Concepts Introduction');
    expect(b.data?.date).toBe('2026-03-07');
    expect(b.data?.categories).toEqual(['AI']);
    expect(b.data?.state).toEqual(['not started']);
  });

  it('CRLF 文件与 BOM 文件都能识别且保留', () => {
    const b = inspect(sampleCrlf);
    expect(b.eol).toBe('\r\n');
    expect(b.hasBom).toBe(false);
    const bom = inspect(BOM + sampleCrlf);
    expect(bom.hasBom).toBe(true);
    expect(bom.hasFrontmatter).toBe(true);
  });

  it('没有 front matter 的文件', () => {
    const b = inspect('# 标题\n\n正文\n');
    expect(b.hasFrontmatter).toBe(false);
  });

  it('没有闭合 --- 的文件按没有 front matter 处理', () => {
    const b = inspect('---\ntitle: x\n\n正文\n');
    expect(b.hasFrontmatter).toBe(false);
  });

  it('非法 YAML 会记录错误而不是抛异常', () => {
    const bad = '---\ntitle: 发现问题: 你好\n---\n正文\n';
    const b = inspect(bad);
    expect(b.hasFrontmatter).toBe(true);
    expect(b.parseError).toBeTruthy();
  });

  it('空 front matter 块', () => {
    const b = inspect('---\n---\n正文\n');
    expect(b.hasFrontmatter).toBe(true);
    expect(b.parseError).toBeUndefined();
    expect(b.data).toEqual({});
  });
});

describe('parseKeyLine', () => {
  it('识别常见写法', () => {
    expect(parseKeyLine('title: x')?.key).toBe('title');
    expect(parseKeyLine('state:')?.key).toBe('state');
    expect(parseKeyLine('tags: []')?.key).toBe('tags');
    expect(parseKeyLine('"my key": v')?.key).toBe('my key');
    expect(parseKeyLine("'quoted': v")?.key).toBe('quoted');
  });

  it('缩进行与纯标量行不算顶层 key', () => {
    expect(parseKeyLine('  - AI')).toBeNull();
    expect(parseKeyLine('  nested: 1')).toBeNull();
    expect(parseKeyLine('http://example.com')).toBeNull();
    expect(parseKeyLine('a:b')).toBeNull();
  });
});

describe('quoteScalar', () => {
  it('安全的值不加引号', () => {
    expect(quoteScalar('AI')).toBe('AI');
    expect(quoteScalar('not started')).toBe('not started');
    expect(quoteScalar('中文标题')).toBe('中文标题');
  });

  it('危险的值加引号', () => {
    expect(quoteScalar('')).toBe('""');
    expect(quoteScalar('123')).toBe('"123"');
    expect(quoteScalar('1.0')).toBe('"1.0"');
    expect(quoteScalar('true')).toBe('"true"');
    expect(quoteScalar('发现问题: 你好')).toBe('"发现问题: 你好"');
    expect(quoteScalar(' 前后有空格 ')).toBe('" 前后有空格 "');
    expect(quoteScalar('# 井号开头')).toBe('"# 井号开头"');
    expect(quoteScalar('含"双引号"')).toBe('"含\\"双引号\\""');
  });

  it('看起来像版本号但不是合法 YAML 数字的值保持裸标量', () => {
    // 1.0.0 不是合法 YAML 数字，不加引号也会被解析成字符串
    expect(quoteScalar('1.0.0')).toBe('1.0.0');
  });
});

describe('setFieldValue：标量字段', () => {
  it('改文本：只动那一行', () => {
    const out = setFieldValue(sampleLf, { key: 'title', type: 'text' }, 'Agent 概念入门', {
      emptyValueStyle: 'null',
    });
    expect(out).toContain('title: Agent 概念入门');
    expect(changedLines(sampleLf, out)).toEqual([1]);
    expect(out.endsWith('正文第一行\n正文第二行\n')).toBe(true);
  });

  it('改日期：去掉引号并统一成 YYYY-MM-DD', () => {
    const out = setFieldValue(sampleLf, { key: 'date', type: 'date' }, '2026-09-13', {
      emptyValueStyle: 'null',
    });
    expect(out).toContain('date: 2026-09-13');
    expect(out).not.toContain("'2026-03-07'");
    expect(changedLines(sampleLf, out)).toEqual([2]);
  });

  it('非法日期被拒绝', () => {
    expect(() =>
      setFieldValue(sampleLf, { key: 'date', type: 'date' }, '2026/09/13', { emptyValueStyle: 'null' }),
    ).toThrow(WriteError);
  });

  it('清空文本：保留 key 写成空值', () => {
    const out = setFieldValue(sampleLf, { key: 'title', type: 'text' }, null, { emptyValueStyle: 'null' });
    expect(out).toContain('title:\n');
    expect(changedLines(sampleLf, out)).toEqual([1]);
  });

  it('emptyValueStyle=remove 时删掉整个字段', () => {
    const out = setFieldValue(sampleLf, { key: 'title', type: 'text' }, null, { emptyValueStyle: 'remove' });
    expect(out).not.toContain('title:');
    expect(inspect(out).data && 'title' in inspect(out).data!).toBe(false);
  });

  it('emptyValueStyle=emptyString 时写成空字符串', () => {
    const out = setFieldValue(sampleLf, { key: 'title', type: 'text' }, null, { emptyValueStyle: 'emptyString' });
    expect(out).toContain('title: ""');
  });

  it('新增字段：插到 front matter 末尾', () => {
    const out = setFieldValue(sampleLf, { key: 'priority', type: 'number' }, 3, { emptyValueStyle: 'null' });
    expect(out).toContain('  - not started\npriority: 3\n---\n');
    const after = inspect(out);
    expect(after.data?.priority).toBe(3);
    expect(after.data?.title).toBe('Agent Concepts Introduction');
    expect(out.endsWith('正文第一行\n正文第二行\n')).toBe(true);
  });
});

describe('setFieldValue：列表字段', () => {
  it('改单项列表（state）：只动那一行的值', () => {
    const out = setFieldValue(sampleLf, { key: 'state', type: 'select' }, 'finished', {
      emptyValueStyle: 'null',
    });
    expect(out).toContain('state:\n  - finished\n');
    expectRegionReplaced(sampleLf, out, '  - not started', '  - finished');
    expect(changedLines(sampleLf, out)).toEqual([9]);
  });

  it('多选：替换整个列表块', () => {
    const out = setFieldValue(sampleLf, { key: 'tags', type: 'multiSelect' }, ['Agent', '工具链', '最佳实践'], {
      emptyValueStyle: 'null',
    });
    expect(out).toContain('tags:\n  - Agent\n  - 工具链\n  - 最佳实践\n');
    expect(inspect(out).data?.tags).toEqual(['Agent', '工具链', '最佳实践']);
  });

  it('清空列表写成 []', () => {
    const out = setFieldValue(sampleLf, { key: 'categories', type: 'select' }, [], { emptyValueStyle: 'null' });
    expect(out).toContain('categories: []');
    expect(inspect(out).data?.categories).toEqual([]);
    // 原来是两行（key 行 + 一个列表项），现在压成一行，其余字节不变
    expectRegionReplaced(sampleLf, out, 'categories:\n  - AI', 'categories: []');
  });

  it('flow 风格列表保持 flow 风格', () => {
    const flow = '---\ntags: [a, b]\n---\n正文\n';
    const out = setFieldValue(flow, { key: 'tags', type: 'multiSelect' }, ['a', 'b', 'c'], {
      emptyValueStyle: 'null',
    });
    expect(out).toContain('tags: [a, b, c]');
    expect(inspect(out).data?.tags).toEqual(['a', 'b', 'c']);
  });

  it('select + scalar 存储写成裸标量', () => {
    const out = setFieldValue(sampleLf, { key: 'state', type: 'select', storage: 'scalar' }, 'finished', {
      emptyValueStyle: 'null',
    });
    expect(out).toContain('state: finished');
    expect(inspect(out).data?.state).toBe('finished');
  });

  it('块状列表里的值含冒号冒号会被加引号，且仍是合法 YAML', () => {
    const out = setFieldValue(sampleLf, { key: 'tags', type: 'multiSelect' }, ['a: b', '正常'], {
      emptyValueStyle: 'null',
    });
    const after = inspect(out);
    expect(after.parseError).toBeUndefined();
    expect(after.data?.tags).toEqual(['a: b', '正常']);
  });
});

describe('保留换行、BOM、注释与其他字段', () => {
  it('CRLF 文件改一处后仍是 CRLF，且只有一行变化', () => {
    const out = setFieldValue(sampleCrlf, { key: 'state', type: 'select' }, 'finished', {
      emptyValueStyle: 'null',
    });
    expect(out).toContain('state:' + CRLF + '  - finished' + CRLF);
    expectRegionReplaced(sampleCrlf, out, '  - not started', '  - finished');
    // 换行符数量不变，说明没有产生混合换行
    expect(out.split(CRLF).length).toBe(sampleCrlf.split(CRLF).length);
    // 除了目标行，其他行逐字节一致
    const a = sampleCrlf.split('\n');
    const b = out.split('\n');
    for (let i = 0; i < a.length; i++) {
      if (i === 9) continue;
      expect(b[i]).toBe(a[i]);
    }
  });

  it('BOM 文件改一处后 BOM 仍在，正文未被动', () => {
    const withBom = BOM + sampleCrlf;
    const out = setFieldValue(withBom, { key: 'title', type: 'text' }, '新标题', { emptyValueStyle: 'null' });
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toContain('title: 新标题' + CRLF);
    expect(out.endsWith('正文第二行' + CRLF)).toBe(true);
    // 整个文件除这一处外必须完全一致
    expect(out.slice(1)).toBe(sampleCrlf.replace('title: Agent Concepts Introduction', 'title: 新标题'));
  });

  it('行尾注释被保留', () => {
    const withComment = '---\ntitle: 旧标题 # 备注\nstate:\n  - not started # 状态\n---\n正文\n';
    const out = setFieldValue(withComment, { key: 'title', type: 'text' }, '新标题', { emptyValueStyle: 'null' });
    expect(out).toContain('title: 新标题 # 备注');
    const out2 = setFieldValue(withComment, { key: 'state', type: 'select' }, 'finished', {
      emptyValueStyle: 'null',
    });
    expect(out2).toContain('state: # 状态\n  - finished');
  });

  it('未改动到的嵌套结构（hero/sitemap）原样保留', () => {
    const nested = [
      '---',
      'title: Demo',
      'hero:',
      '  name: Vibe Vibe',
      '  text: 人人都能 AI 创造',
      'sitemap:',
      '  changefreq: weekly',
      '  priority: 0.9',
      '---',
      '正文',
      '',
    ].join('\n');
    const out = setFieldValue(nested, { key: 'title', type: 'text' }, 'Demo2', { emptyValueStyle: 'null' });
    expect(out).toContain('hero:\n  name: Vibe Vibe\n  text: 人人都能 AI 创造\n');
    expect(out).toContain('sitemap:\n  changefreq: weekly\n  priority: 0.9\n');
    expect(changedLines(nested, out)).toEqual([1]);
  });
});

describe('拒绝不安全的写入', () => {
  it('嵌套对象字段拒绝写入', () => {
    const nested = '---\ntitle: Demo\nhero:\n  name: Vibe Vibe\n---\n正文\n';
    expect(() => setFieldValue(nested, { key: 'hero', type: 'text' }, 'x', { emptyValueStyle: 'null' })).toThrow(
      /嵌套结构/,
    );
  });

  it('对象列表字段拒绝写入', () => {
    const nested = '---\nfeatures:\n  - title: 零基础\n    details: 说明\n---\n正文\n';
    expect(() =>
      setFieldValue(nested, { key: 'features', type: 'multiSelect' }, ['x'], { emptyValueStyle: 'null' }),
    ).toThrow(/对象列表/);
  });

  it('非法 YAML 文件拒绝写入', () => {
    const bad = '---\ntitle: 发现问题: 你好\n---\n正文\n';
    expect(() => setFieldValue(bad, { key: 'title', type: 'text' }, 'x', { emptyValueStyle: 'null' })).toThrow(
      /合法 YAML/,
    );
  });

  it('没有 front matter 的文件拒绝写入', () => {
    expect(() =>
      setFieldValue('# 只有正文\n', { key: 'title', type: 'text' }, 'x', { emptyValueStyle: 'null' }),
    ).toThrow(/没有 front matter/);
  });

  it('字段名里有冒号等特殊字符时不会写坏文件', () => {
    const out = setFieldValue(sampleLf, { key: 'note', type: 'text' }, 'a: b', { emptyValueStyle: 'null' });
    expect(inspect(out).parseError).toBeUndefined();
    expect(inspect(out).data?.note).toBe('a: b');
  });
});

describe('removeFieldValue', () => {
  it('删除一个块状列表字段，其余不动', () => {
    const out = removeFieldValue(sampleLf, 'tags');
    expect(out).not.toContain('tags:');
    expect(inspect(out).data?.tags).toBeUndefined();
    expect(inspect(out).data?.state).toEqual(['not started']);
    expectRegionReplaced(sampleLf, out, 'tags:\n  - Agent\n  - 工程纪律\n', '');
  });
});

describe('addSkeleton', () => {
  const specs = [
    { key: 'title', type: 'text' as const },
    { key: 'date', type: 'date' as const },
    { key: 'categories', type: 'select' as const },
    { key: 'tags', type: 'multiSelect' as const },
    { key: 'state', type: 'select' as const },
  ];

  it('给普通 md 文件补骨架，正文逐字节保留', () => {
    const src = '# 我的笔记\n\n这是正文。\n';
    const out = addSkeleton(src, specs, { today: '2026-09-13', stateDefault: ['not started'] });
    const expectedHead = [
      '---',
      'title:',
      'date: 2026-09-13',
      'categories: []',
      'tags: []',
      'state:',
      '  - not started',
      '---',
      '',
      '',
    ].join('\n');
    expect(out).toBe(expectedHead + src);
    expect(inspect(out).parseError).toBeUndefined();
    expect(inspect(out).data?.state).toEqual(['not started']);
  });

  it('CRLF + BOM 文件补骨架后 BOM 与 CRLF 都保留，正文一致', () => {
    const src = BOM + '# 笔记' + CRLF + CRLF + '正文' + CRLF;
    const out = addSkeleton(src, specs, { today: '2026-09-13', stateDefault: ['not started'] });
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toContain('---' + CRLF + 'title:' + CRLF);
    expect(out.endsWith('# 笔记' + CRLF + CRLF + '正文' + CRLF)).toBe(true);
  });

  it('已经有 front matter 时拒绝', () => {
    expect(() => addSkeleton(sampleLf, specs, {})).toThrow(/已经有 front matter/);
  });

  it('空文件也能补', () => {
    const out = addSkeleton('', specs, { today: '2026-09-13', stateDefault: ['not started'] });
    expect(inspect(out).parseError).toBeUndefined();
    expect(inspect(out).data?.date).toBe('2026-09-13');
  });
});

describe('findField', () => {
  it('返回精确的字段位置', () => {
    const block = inspect(sampleLf);
    const loc = findField(sampleLf, block, 'state');
    expect(loc).toBeTruthy();
    expect(sampleLf.slice(loc!.keyLineStart, loc!.keyLineEnd)).toBe('state:');
    expect(sampleLf.slice(loc!.colonAbs + 1, loc!.blockEnd)).toBe('\n  - not started');
    expect(loc!.hasContinuation).toBe(true);
    expect(loc!.indent).toBe('  ');
  });

  it('没有的字段返回 null', () => {
    expect(findField(sampleLf, inspect(sampleLf), 'nope')).toBeNull();
  });
});
