import { describe, expect, it } from 'vitest';
import { createMatcher, matchesAny } from '../src/shared/glob';

const defaults = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.trash/**',
  '**/.obsidian/**',
  '**/.mattertable/**',
  '**/20 Raw/**',
  '**/30 Raw/**',
  '**/.helloagents/**',
  '5 Projects/**',
];

describe('createMatcher（默认忽略清单）', () => {
  it('排除第三方仓库目录及其内容', () => {
    const ignored = createMatcher(defaults);
    expect(ignored('2 Fullstack Dev/20 Raw/javaguide/README.md')).toBe(true);
    expect(ignored('2 Fullstack Dev/20 Raw')).toBe(true);
    expect(ignored('3 Agent Dev/30 Raw/hello-agents/docs/x.md')).toBe(true);
    expect(ignored('3 Agent Dev/30 Raw')).toBe(true);
  });

  it('排除代码仓库与依赖目录', () => {
    const ignored = createMatcher(defaults);
    expect(ignored('5 Projects/MatterTable/README.md')).toBe(true);
    expect(ignored('5 Projects')).toBe(true);
    expect(ignored('2 Fullstack Dev/20 Raw/x/node_modules/pkg/README.md')).toBe(true);
    expect(ignored('5 Projects/MatterTable/docs/PRD.md')).toBe(true);
  });

  it('不误伤名字相近的目录', () => {
    const ignored = createMatcher(defaults);
    expect(ignored('2 Fullstack Dev/20 Raws/a.md')).toBe(false);
    expect(ignored('2 Fullstack Dev/21 Backend Dev/1.Python.md')).toBe(false);
    expect(ignored('3 Agent Dev/31 Concepts/1.Agent Concepts Introduction.md')).toBe(false);
    expect(ignored('0 Core/01 Personal Management/Tasks Arrangement.md')).toBe(false);
    expect(ignored('4 Deeplearning/note.md')).toBe(false);
  });

  it('忽略清单为空时什么都不排除', () => {
    const ignored = createMatcher([]);
    expect(ignored('anything/at/all.md')).toBe(false);
  });

  it('matchesAny 与 createMatcher 行为一致', () => {
    expect(matchesAny('5 Projects/a.md', defaults)).toBe(true);
    expect(matchesAny('2 Fullstack Dev/21 Backend Dev/a.md', defaults)).toBe(false);
  });
});

describe('include 模式', () => {
  const isIncluded = createMatcher(['**/*.md']);

  it('匹配任意层级的 md 文件', () => {
    expect(isIncluded('a.md')).toBe(true);
    expect(isIncluded('x/y/z/a.md')).toBe(true);
    expect(isIncluded('1.Python.md')).toBe(true);
  });

  it('不匹配非 md 文件', () => {
    expect(isIncluded('a.txt')).toBe(false);
    expect(isIncluded('x/y/a.png')).toBe(false);
    expect(isIncluded('a.md.bak')).toBe(false);
  });
});

describe('其他 glob 写法', () => {
  it('**/*.md 与 * 的区别', () => {
    expect(createMatcher(['*.md'])('a.md')).toBe(true);
    expect(createMatcher(['*.md'])('x/a.md')).toBe(false);
  });

  it('只匹配目录自身时其内容也被排除', () => {
    const ignored = createMatcher(['**/Raw']);
    expect(ignored('2 Fullstack Dev/Raw')).toBe(true);
    expect(ignored('2 Fullstack Dev/Raw/a/b.md')).toBe(true);
    // 名字不同的目录不受影响
    expect(ignored('2 Fullstack Dev/20 Raw/a.md')).toBe(false);
  });
});
