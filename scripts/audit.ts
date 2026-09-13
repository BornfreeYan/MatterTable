/**
 * 开发用审计脚本（不参与打包）。
 *
 * 拿真实知识库跑一遍：扫描 → 解析 → 把每个字段的「当前值」原样模拟写回，
 * 检查结果是否与原文逐字节一致。用来验证「除了目标片段，其他字节不动」这个承诺。
 *
 * 用法：
 *   node_modules/.bin/esbuild scripts/audit.ts --bundle --platform=node --format=esm \
 *     --outfile=dist/audit.mjs && node dist/audit.mjs "D:/KnowledgeBase"
 */
import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { createMatcher } from '../src/shared/glob';
import type { CellValue, FieldType, SelectStorage } from '../src/shared/types';
import { toCellValue } from '../src/shared/values';
import { inspect, setFieldValue, type WriteSpec } from '../src/extension/writer';

const ROOT = process.argv[2] ?? 'D:/KnowledgeBase';

const EXCLUDE = [
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
const INCLUDE = ['**/*.md'];

/** 与默认配置一致的声明 */
const DECLARED: Record<string, { type: FieldType; storage?: SelectStorage }> = {
  title: { type: 'text' },
  date: { type: 'date' },
  categories: { type: 'select', storage: 'list' },
  state: { type: 'select', storage: 'list' },
  tags: { type: 'multiSelect' },
  description: { type: 'text' },
};

function inferSpec(key: string, value: CellValue): WriteSpec {
  const declared = DECLARED[key];
  if (declared) return { key, type: declared.type, storage: declared.storage };
  if (Array.isArray(value)) return { key, type: 'multiSelect' };
  if (typeof value === 'number') return { key, type: 'number' };
  if (typeof value === 'boolean') return { key, type: 'checkbox' };
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return { key, type: 'date' };
  return { key, type: 'text' };
}

interface Counters {
  files: number;
  ignored: number;
  totalMd: number;
  withoutFrontmatter: number;
  unparsable: number;
  complexFields: number;
  identical: number;
  reformatted: Map<string, number>;
  reformatSamples: Map<string, string>;
  dateReasons: Map<string, number>;
  writeErrors: Map<string, string>;
}

const c: Counters = {
  files: 0,
  ignored: 0,
  totalMd: 0,
  withoutFrontmatter: 0,
  unparsable: 0,
  complexFields: 0,
  identical: 0,
  reformatted: new Map(),
  reformatSamples: new Map(),
  dateReasons: new Map(),
  writeErrors: new Map(),
};

const isIgnored = createMatcher(EXCLUDE);
const isIncluded = createMatcher(INCLUDE);

/** 全库 md 总数（只排除依赖与版本控制目录），用于对比忽略清单的效果 */
async function countAllMd(dir: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await countAllMd(full);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) c.totalMd++;
  }
}

async function walk(dir: string, rel: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRel = rel === '' ? entry.name : rel + '/' + entry.name;
    if (isIgnored(childRel)) {
      c.ignored++;
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, childRel);
      continue;
    }
    if (!entry.isFile() || !isIncluded(childRel)) continue;
    c.files++;
    await auditFile(full, childRel);
  }
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

async function auditFile(full: string, rel: string): Promise<void> {
  let raw: string;
  try {
    const bytes = await readFile(full);
    raw = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  } catch {
    return;
  }
  const block = inspect(raw);
  if (!block.hasFrontmatter) {
    c.withoutFrontmatter++;
    return;
  }
  if (block.parseError) {
    c.unparsable++;
    bump(c.writeErrors, `__unparsable__`);
    return;
  }
  if (!block.data) return;

  for (const [key, yamlValue] of Object.entries(block.data)) {
    const normalized = toCellValue(yamlValue);
    if (normalized.complex) {
      c.complexFields++;
      continue;
    }
    const spec = inferSpec(key, normalized.value);
    let result: string;
    try {
      result = setFieldValue(raw, spec, normalized.value, { emptyValueStyle: 'null' });
    } catch (err) {
      bump(c.writeErrors, `${key}: ${String((err as Error).message).slice(0, 80)}`);
      continue;
    }
    if (result === raw) {
      c.identical++;
    } else {
      bump(c.reformatted, key);
      if (key === 'date') {
        const matched = /^\s*date:\s*(.*)$/m.exec(raw);
        const rawValue = matched ? matched[1].trim() : '';
        const reason =
          rawValue === '""' || rawValue === "''"
            ? 'date: 空字符串 "" → 空值'
            : rawValue.startsWith("'") || rawValue.startsWith('"')
              ? 'date: 去掉引号（统一成裸日期）'
              : 'date: 其他';
        bump(c.dateReasons, reason);
      }
      if (!c.reformatSamples.has(key)) {
        // 找出第一处差异，便于人工判断是「预期内的规范化」还是 bug
        let i = 0;
        while (i < raw.length && i < result.length && raw[i] === result[i]) i++;
        const from = raw.slice(Math.max(0, i - 20), i + 30).replace(/\r?\n/g, '⏎');
        const to = result.slice(Math.max(0, i - 20), i + 30).replace(/\r?\n/g, '⏎');
        c.reformatSamples.set(key, `${rel}\n      原文: …${from}…\n      写回: …${to}…`);
      }
    }
  }
}

async function main(): Promise<void> {
  const started = Date.now();
  await walk(ROOT, '');
  const elapsed = Date.now() - started;
  await countAllMd(ROOT);

  const pct = (n: number, total: number) => `${((n / Math.max(1, total)) * 100).toFixed(1)}%`;

  console.log('===== MatterTable 真实数据审计 =====');
  console.log(`扫描根目录：${ROOT}`);
  console.log(`扫描耗时：${elapsed} ms`);
  console.log('');
  console.log(`全库 markdown 总数（不含 node_modules/.git）：${c.totalMd}`);
  console.log(`按默认忽略清单实际参与扫描：${c.files}（忽略掉 ${pct(c.totalMd - c.files, c.totalMd)}）`);
  console.log(`没有 front matter：${c.withoutFrontmatter}（${pct(c.withoutFrontmatter, c.files)}）`);
  console.log(`front matter 非法 YAML：${c.unparsable}`);
  console.log(`嵌套结构字段（只读）：${c.complexFields}`);
  console.log('');
  console.log(`模拟写回：字段值原样写回后逐字节一致：${c.identical} 次`);
  const reformatTotal = [...c.reformatted.values()].reduce((a, b) => a + b, 0);
  console.log(`模拟写回：需要规范化的字段：${reformatTotal} 次`);
  if (c.reformatted.size > 0) {
    console.log('');
    console.log('  按字段统计：');
    for (const [key, count] of [...c.reformatted.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${key}: ${count}`);
    }
    console.log('');
    console.log('  date 字段的规范化原因：');
    for (const [reason, count] of [...c.dateReasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${count} × ${reason}`);
    }
    console.log('');
    console.log('  每字段一个样例：');
    for (const [key, sample] of c.reformatSamples) {
      console.log(`    [${key}] ${sample}`);
    }
  }
  if (c.writeErrors.size > 0) {
    console.log('');
    console.log(`写入报错：${[...c.writeErrors.values()].reduce((a, b) => a + b, 0)} 次`);
    for (const [key, count] of [...c.writeErrors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`    ${count} × ${key}`);
    }
  }
}

void main();
