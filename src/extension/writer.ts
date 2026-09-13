/**
 * 行级最小改写写入器。
 *
 * 设计原则：除了目标字段对应的那一段字符，文件其余字节一个都不动——
 * 换行符（CRLF/LF）、BOM、引号风格、块状列表、注释、缩进全部原样保留。
 *
 * 本文件刻意不 import 'vscode'，因此可以被 vitest 直接单元测试。
 */
import { parse as parseYaml } from 'yaml';
import type { CellValue, EmptyValueStyle, FieldType, SelectStorage } from '../shared/types';
import { formatDateValue, isEmptyValue, listItems } from '../shared/values';

export type WriteErrorCode =
  | 'NO_FRONTMATTER'
  | 'UNPARSABLE'
  | 'FIELD_COMPLEX'
  | 'ALREADY_HAS_FRONTMATTER'
  | 'INVALID_VALUE'
  | 'VERIFY_FAILED';

export class WriteError extends Error {
  constructor(
    public readonly code: WriteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WriteError';
  }
}

export interface FrontmatterBlock {
  hasFrontmatter: boolean;
  hasBom: boolean;
  eol: string;
  /** 开头 `---` 那一行之后的偏移量 */
  contentStart: number;
  /** 结尾 `---` 那一行的起始偏移量 */
  contentEnd: number;
  yamlText: string;
  data: Record<string, unknown> | null;
  parseError?: string;
}

export interface Line {
  start: number;
  end: number;
  text: string;
}

export interface FieldLocation {
  key: string;
  keyLineStart: number;
  keyLineEnd: number;
  /** 冒号本身的偏移量 */
  colonAbs: number;
  inlineStart: number;
  inlineEnd: number;
  /** 行尾注释（含 `#`），没有则为空串 */
  comment: string;
  /** 该字段整块（含续行）结束后的偏移量（不含行尾换行） */
  blockEnd: number;
  /** 该字段下一行的起始偏移量（删除字段时用） */
  nextLineStart: number;
  inlineRaw: string;
  flowList: boolean;
  /** 续行的缩进（如 `  `），没有续行时为空串 */
  indent: string;
  hasContinuation: boolean;
}

export interface WriteSpec {
  key: string;
  type: FieldType;
  storage?: SelectStorage;
}

export interface WriteSettings {
  emptyValueStyle: EmptyValueStyle;
}

const OPEN_RE = /^---[ \t]*$/;

function stripCr(s: string): string {
  return s.endsWith('\r') ? s.slice(0, -1) : s;
}

/** 去掉 CRLF 里的 `\r`：返回内容的真实结尾偏移量 */
function trimCrAt(raw: string, idx: number): number {
  return idx > 0 && raw[idx - 1] === '\r' ? idx - 1 : idx;
}

function linesOf(raw: string, from: number, to: number): Line[] {
  const lines: Line[] = [];
  let pos = from;
  while (pos < to) {
    const nl = raw.indexOf('\n', pos);
    if (nl === -1 || nl >= to) {
      lines.push({ start: pos, end: to, text: stripCr(raw.slice(pos, to)) });
      break;
    }
    lines.push({ start: pos, end: nl, text: stripCr(raw.slice(pos, nl)) });
    pos = nl + 1;
  }
  return lines;
}

/** 找出 YAML 行内值的注释起点（跳过引号内的 `#`） */
function findComment(s: string): number {
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (quote === '"' && c === '\\') {
        i++;
        continue;
      }
      if (c === quote) {
        if (quote === "'" && s[i + 1] === "'") {
          i++;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '#' && (i === 0 || s[i - 1] === ' ' || s[i - 1] === '\t')) return i;
  }
  return -1;
}

interface KeyLine {
  key: string;
  colonIndex: number;
}

/** 解析一行是不是顶层 `key:` 行；不是（缩进行、纯标量行）则返回 null */
export function parseKeyLine(text: string): KeyLine | null {
  if (text === '' || /^\s/.test(text)) return null;
  if (text[0] === '"' || text[0] === "'") {
    const quote = text[0];
    let j = 1;
    let buf = '';
    while (j < text.length) {
      const c = text[j];
      if (quote === "'" && c === "'" && text[j + 1] === "'") {
        buf += "'";
        j += 2;
        continue;
      }
      if (c === quote) break;
      if (quote === '"' && c === '\\') {
        buf += text[j + 1] ?? '';
        j += 2;
        continue;
      }
      buf += c;
      j++;
    }
    if (text[j] !== quote) return null;
    if (text[j + 1] !== ':') return null;
    return { key: buf, colonIndex: j + 1 };
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ':') continue;
    const next = text[i + 1];
    if (next === undefined || next === ' ' || next === '\t') {
      return { key: text.slice(0, i), colonIndex: i };
    }
  }
  return null;
}

export function inspect(raw: string): FrontmatterBlock {
  const hasBom = raw.charCodeAt(0) === 0xfeff;
  const bomOffset = hasBom ? 1 : 0;
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const base: FrontmatterBlock = {
    hasFrontmatter: false,
    hasBom,
    eol,
    contentStart: 0,
    contentEnd: 0,
    yamlText: '',
    data: null,
  };
  const firstLineEnd = raw.indexOf('\n', bomOffset);
  if (firstLineEnd === -1) return base;
  if (!OPEN_RE.test(stripCr(raw.slice(bomOffset, firstLineEnd)))) return base;
  const contentStart = firstLineEnd + 1;
  let pos = contentStart;
  let contentEnd = -1;
  while (pos <= raw.length) {
    const nl = raw.indexOf('\n', pos);
    const end = nl === -1 ? raw.length : nl;
    if (OPEN_RE.test(stripCr(raw.slice(pos, end)))) {
      contentEnd = pos;
      break;
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  if (contentEnd === -1) return base;
  const yamlText = raw.slice(contentStart, contentEnd);
  const out: FrontmatterBlock = {
    hasFrontmatter: true,
    hasBom,
    eol,
    contentStart,
    contentEnd,
    yamlText,
    data: null,
  };
  if (yamlText.trim() === '') {
    out.data = {};
    return out;
  }
  try {
    const parsed: unknown = parseYaml(yamlText);
    if (parsed === null || parsed === undefined) {
      out.data = {};
    } else if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      out.data = parsed as Record<string, unknown>;
    } else {
      out.parseError = '前置信息不是一个键值对结构';
    }
  } catch (err) {
    out.parseError = String((err as Error).message).split('\n')[0];
  }
  return out;
}

export function findField(raw: string, block: FrontmatterBlock, key: string): FieldLocation | null {
  const lines = linesOf(raw, block.contentStart, block.contentEnd);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parsed = parseKeyLine(line.text);
    if (!parsed || parsed.key !== key) continue;
    const lineEnd = trimCrAt(raw, line.end);
    const colonAbs = line.start + parsed.colonIndex;
    let p = colonAbs + 1;
    while (p < lineEnd && (raw[p] === ' ' || raw[p] === '\t')) p++;
    const inlineStart = p;
    let inlineEnd = lineEnd;
    let comment = '';
    const rest = raw.slice(inlineStart, lineEnd);
    const cIdx = findComment(rest);
    if (cIdx >= 0) {
      comment = rest.slice(cIdx);
      inlineEnd = inlineStart + cIdx;
      while (inlineEnd > inlineStart && /\s/.test(raw[inlineEnd - 1])) inlineEnd--;
    }
    let last = i;
    let indent = '';
    let contComment = '';
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].text;
      if (t.trim() === '') break;
      if (!/^\s/.test(t)) break;
      if (indent === '') {
        const m = /^([ \t]+)/.exec(t);
        indent = m ? m[1] : '';
      }
      const cc = findComment(t);
      if (cc >= 0) contComment = t.slice(cc);
      last = j;
    }
    const inlineRaw = raw.slice(inlineStart, inlineEnd);
    return {
      key,
      keyLineStart: line.start,
      keyLineEnd: lineEnd,
      colonAbs,
      inlineStart,
      inlineEnd,
      // 字段行上的注释优先；否则把列表块内部最后一处行内注释上移，避免改列表时丢注释
      comment: comment || contComment,
      blockEnd: trimCrAt(raw, lines[last].end),
      nextLineStart: last + 1 < lines.length ? lines[last + 1].start : block.contentEnd,
      inlineRaw,
      flowList: inlineRaw.startsWith('['),
      indent,
      hasContinuation: last > i,
    };
  }
  return null;
}

function detectIndent(raw: string, block: FrontmatterBlock): string {
  for (const line of linesOf(raw, block.contentStart, block.contentEnd)) {
    const m = /^([ \t]+)-[ \t]/.exec(line.text);
    if (m) return m[1];
  }
  return '  ';
}

function isPlainSafe(s: string): boolean {
  if (s === '') return false;
  if (/^\s|\s$/.test(s)) return false;
  if (/[\n\r\t]/.test(s)) return false;
  if (/^(true|false|null|~|yes|no|on|off)$/i.test(s)) return false;
  if (/^[-+]?(\d[\d_]*)(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s)) return false;
  if (/:\s/.test(s) || /:$/.test(s) || /\s#/.test(s)) return false;
  if (/["'\\]/.test(s)) return false;
  return true;
}

/** 需要时给标量加引号，避免写出坏 YAML */
export function quoteScalar(s: string): string {
  if (isPlainSafe(s)) return s;
  return JSON.stringify(s);
}

interface SerializeContext {
  eol: string;
  indent: string;
  flow: boolean;
  comment: string;
}

function serializeValueRegion(
  spec: WriteSpec,
  value: CellValue,
  settings: WriteSettings,
  ctx: SerializeContext,
): string {
  const cmt = ctx.comment ? ' ' + ctx.comment : '';
  const listType = spec.type === 'select' || spec.type === 'multiSelect';

  if (isEmptyValue(value)) {
    if (listType) return settings.emptyValueStyle === 'emptyString' ? ' ""' + cmt : ' []' + cmt;
    if (settings.emptyValueStyle === 'emptyString') return ' ""' + cmt;
    return cmt;
  }

  switch (spec.type) {
    case 'text':
      return ' ' + quoteScalar(String(value)) + cmt;
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) throw new WriteError('INVALID_VALUE', `不是合法的数字：${String(value)}`);
      return ' ' + String(n) + cmt;
    }
    case 'checkbox':
      return ' ' + (value === true ? 'true' : 'false') + cmt;
    case 'date': {
      const s = String(value).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        throw new WriteError('INVALID_VALUE', `日期格式应为 YYYY-MM-DD：${s}`);
      }
      return ' ' + s + cmt;
    }
    case 'select':
    case 'multiSelect': {
      const items = listItems(value);
      if (items.length === 0) return ' []' + cmt;
      if (spec.type === 'select' && (spec.storage ?? 'list') === 'scalar' && items.length === 1) {
        return ' ' + quoteScalar(items[0]) + cmt;
      }
      if (ctx.flow) return ' [' + items.map(quoteScalar).join(', ') + ']' + cmt;
      return cmt + ctx.eol + items.map((v) => ctx.indent + '- ' + quoteScalar(v)).join(ctx.eol);
    }
    default:
      throw new WriteError('INVALID_VALUE', `不支持的字段类型：${String(spec.type)}`);
  }
}

function matchesAfterWrite(actual: unknown, spec: WriteSpec, value: CellValue): boolean {
  const listType = spec.type === 'select' || spec.type === 'multiSelect';
  if (listType) {
    // 单选/多选：空列表（含只有空项的情况）应当写回 []
    const items = listItems(value);
    if (items.length === 0) return Array.isArray(actual) && actual.length === 0;
    if (spec.type === 'select' && (spec.storage ?? 'list') === 'scalar' && items.length === 1) {
      return typeof actual === 'string' && actual === items[0];
    }
    return Array.isArray(actual) && actual.length === items.length && actual.every((v, i) => String(v) === items[i]);
  }
  if (isEmptyValue(value)) {
    // emptyValueStyle 可能是 null（写成空）或 emptyString（写成 ""）
    return actual === null || actual === undefined || actual === '';
  }
  switch (spec.type) {
    case 'text':
      return typeof actual === 'string' && actual === String(value);
    case 'date':
      return typeof actual === 'string' && actual === String(value);
    case 'number':
      return typeof actual === 'number' && actual === Number(value);
    case 'checkbox':
      return actual === (value === true);
    default:
      return false;
  }
}

function assertWritable(block: FrontmatterBlock, spec: WriteSpec): void {
  const existing = block.data ? block.data[spec.key] : undefined;
  if (existing === undefined || existing === null) return;
  if (typeof existing === 'object' && !Array.isArray(existing)) {
    throw new WriteError('FIELD_COMPLEX', `字段 ${spec.key} 的值是嵌套结构，MatterTable 不支持编辑`);
  }
  if (Array.isArray(existing) && existing.some((item) => item !== null && typeof item === 'object')) {
    throw new WriteError('FIELD_COMPLEX', `字段 ${spec.key} 的值是对象列表，MatterTable 不支持编辑`);
  }
}

function assertParsable(block: FrontmatterBlock): void {
  if (!block.hasFrontmatter) {
    throw new WriteError('NO_FRONTMATTER', '该文件没有 front matter（可用「补骨架」添加）');
  }
  if (block.parseError) {
    throw new WriteError('UNPARSABLE', `front matter 不是合法 YAML：${block.parseError}`);
  }
}

export function removeFieldValue(raw: string, key: string): string {
  const block = inspect(raw);
  assertParsable(block);
  const loc = findField(raw, block, key);
  if (!loc) return raw;
  const text = raw.slice(0, loc.keyLineStart) + raw.slice(loc.nextLineStart);
  const check = inspect(text);
  if (!check.hasFrontmatter || check.parseError || (check.data && key in check.data)) {
    throw new WriteError('VERIFY_FAILED', `删除字段 ${key} 后校验失败`);
  }
  return text;
}

/** 设置一个字段的值，返回改写后的完整文件内容 */
export function setFieldValue(
  raw: string,
  spec: WriteSpec,
  value: CellValue,
  settings: WriteSettings,
): string {
  const block = inspect(raw);
  assertParsable(block);
  assertWritable(block, spec);

  const loc = findField(raw, block, spec.key);
  if (isEmptyValue(value) && settings.emptyValueStyle === 'remove') {
    if (!loc) return raw;
    return removeFieldValue(raw, spec.key);
  }

  const ctx: SerializeContext = {
    eol: block.eol,
    indent: loc?.indent || detectIndent(raw, block),
    flow: loc?.flowList ?? false,
    comment: loc?.comment ?? '',
  };
  const replacement = serializeValueRegion(spec, value, settings, ctx);

  const text = loc
    ? raw.slice(0, loc.colonAbs + 1) + replacement + raw.slice(loc.blockEnd)
    : raw.slice(0, block.contentEnd) + spec.key + ':' + replacement + block.eol + raw.slice(block.contentEnd);

  const check = inspect(text);
  if (!check.hasFrontmatter || check.parseError) {
    throw new WriteError('VERIFY_FAILED', `改写后 front matter 不是合法 YAML：${check.parseError ?? ''}`);
  }
  const actual = check.data ? check.data[spec.key] : undefined;
  if (!matchesAfterWrite(actual, spec, value)) {
    throw new WriteError('VERIFY_FAILED', `改写后校验失败：${spec.key} 的值与预期不一致`);
  }
  return text;
}

export interface SkeletonOptions {
  autoFillDateToday?: boolean;
  today?: string;
  stateDefault?: string[];
  dateKey?: string;
  stateKey?: string;
}

/** 给没有 front matter 的文件在顶部补一个骨架 */
export function addSkeleton(
  raw: string,
  specs: readonly WriteSpec[],
  opts: SkeletonOptions = {},
): string {
  const hasBom = raw.charCodeAt(0) === 0xfeff;
  const body = hasBom ? raw.slice(1) : raw;
  if (inspect(body).hasFrontmatter) {
    throw new WriteError('ALREADY_HAS_FRONTMATTER', '该文件已经有 front matter');
  }
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const today = opts.today ?? formatDateValue(new Date());
  const dateKey = opts.dateKey ?? 'date';
  const stateKey = opts.stateKey ?? 'state';
  const autoFillDate = opts.autoFillDateToday ?? true;

  const lines: string[] = ['---'];
  for (const spec of specs) {
    if (spec.key === dateKey && autoFillDate) {
      lines.push(`${spec.key}: ${today}`);
      continue;
    }
    const isList = spec.type === 'select' || spec.type === 'multiSelect';
    const values = spec.key === stateKey ? (opts.stateDefault ?? []) : [];
    if (isList) {
      if (values.length === 0) {
        lines.push(`${spec.key}: []`);
      } else {
        lines.push(`${spec.key}:`);
        for (const v of values) lines.push('  - ' + quoteScalar(v));
      }
    } else {
      lines.push(`${spec.key}:`);
    }
  }
  lines.push('---');

  const trimmedBody = body.replace(/^(?:[ \t]*\r?\n)+/, '');
  const head = (hasBom ? '\ufeff' : '') + lines.join(eol) + eol;
  const text = trimmedBody === '' ? head : head + eol + trimmedBody;

  const check = inspect(text);
  if (!check.hasFrontmatter || check.parseError) {
    throw new WriteError('VERIFY_FAILED', `补骨架后校验失败：${check.parseError ?? ''}`);
  }
  if (trimmedBody !== '' && !text.endsWith(trimmedBody)) {
    throw new WriteError('VERIFY_FAILED', '补骨架后校验失败：正文被改动');
  }
  return text;
}
