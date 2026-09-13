import * as vscode from 'vscode';
import { open } from 'node:fs/promises';
import { createMatcher } from '../shared/glob';
import type { CellValue } from '../shared/types';
import { toCellValue } from '../shared/values';
import { CACHE_KEY } from './config';
import { inspect } from './writer';

export interface ScannedRow {
  uri: vscode.Uri;
  relPath: string;
  fileName: string;
  mtime: number;
  size: number;
  values: Record<string, CellValue>;
  hasFrontmatter: boolean;
  parseError?: string;
  complexKeys: string[];
}

export interface CacheEntry {
  mtime: number;
  size: number;
  values: Record<string, CellValue>;
  hasFrontmatter: boolean;
  parseError?: string;
  complexKeys: string[];
}

/** ignoreBOM: true 表示保留 BOM 字符，这样改写后还能原样写回 */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

/** 只读文件开头（front matter 一定在前面），大文件不必整份读进来 */
export async function readHead(
  uri: vscode.Uri,
  maxBytes = 64 * 1024,
): Promise<{ text: string; truncated: boolean }> {
  const handle = await open(uri.fsPath, 'r');
  try {
    const stat = await handle.stat();
    const len = Math.min(stat.size, maxBytes);
    const buf = new Uint8Array(len);
    const { bytesRead } = await handle.read(buf, 0, len, 0);
    return { text: decodeUtf8(buf.subarray(0, bytesRead)), truncated: stat.size > maxBytes };
  } finally {
    await handle.close();
  }
}

export async function readWhole(uri: vscode.Uri): Promise<string> {
  return decodeUtf8(await vscode.workspace.fs.readFile(uri));
}

export interface WalkedFile {
  uri: vscode.Uri;
  relPath: string;
  fileName: string;
}

export async function walkMarkdown(
  root: vscode.Uri,
  include: readonly string[],
  exclude: readonly string[],
): Promise<WalkedFile[]> {
  const isIgnored = createMatcher(exclude);
  const isIncluded = createMatcher(include.length > 0 ? include : ['**/*.md']);
  const out: WalkedFile[] = [];

  const visit = async (dir: vscode.Uri, rel: string): Promise<void> => {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return; // 没权限或已被删除，跳过
    }
    for (const [name, type] of entries) {
      const childRel = rel === '' ? name : rel + '/' + name;
      if (isIgnored(childRel)) continue;
      // 不跟随符号链接，避免目录循环或跑到库外面
      if ((type & vscode.FileType.SymbolicLink) !== 0) continue;
      if ((type & vscode.FileType.Directory) !== 0) {
        await visit(vscode.Uri.joinPath(dir, name), childRel);
        continue;
      }
      if ((type & vscode.FileType.File) !== 0 && isIncluded(childRel)) {
        out.push({ uri: vscode.Uri.joinPath(dir, name), relPath: childRel, fileName: name });
      }
    }
  };

  await visit(root, '');
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

export async function parseFile(file: WalkedFile): Promise<ScannedRow> {
  const stat = await vscode.workspace.fs.stat(file.uri);
  const head = await readHead(file.uri);
  let raw = head.text;
  let block = inspect(raw);
  if (!block.hasFrontmatter && head.truncated) {
    raw = await readWhole(file.uri);
    block = inspect(raw);
  }
  const values: Record<string, CellValue> = {};
  const complexKeys: string[] = [];
  if (block.data) {
    for (const [key, value] of Object.entries(block.data)) {
      const norm = toCellValue(value);
      if (norm.complex) {
        complexKeys.push(key);
        continue;
      }
      values[key] = norm.value;
    }
  }
  return {
    uri: file.uri,
    relPath: file.relPath,
    fileName: file.fileName,
    mtime: stat.mtime,
    size: stat.size,
    values,
    hasFrontmatter: block.hasFrontmatter,
    parseError: block.parseError,
    complexKeys,
  };
}

/**
 * 行缓存：按「相对路径 → {mtime, size, 解析结果}」缓存，写一次全局存储。
 * 修改时间和大小都没变的文件直接复用，不再读盘解析。
 */
export class RowCache {
  private data: Record<string, Record<string, CacheEntry>> = {};
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    const saved = ctx.globalState.get<Record<string, Record<string, CacheEntry>>>(CACHE_KEY);
    if (saved && typeof saved === 'object') this.data = saved;
  }

  get(rootKey: string, relPath: string, mtime: number, size: number): CacheEntry | undefined {
    const entry = this.data[rootKey]?.[relPath];
    if (!entry) return undefined;
    if (entry.mtime !== mtime || entry.size !== size) return undefined;
    return entry;
  }

  set(rootKey: string, relPath: string, entry: CacheEntry): void {
    let bucket = this.data[rootKey];
    if (!bucket) {
      bucket = {};
      this.data[rootKey] = bucket;
    }
    bucket[relPath] = entry;
    this.scheduleFlush();
  }

  remove(rootKey: string, relPath: string): void {
    const bucket = this.data[rootKey];
    if (!bucket || !(relPath in bucket)) return;
    delete bucket[relPath];
    this.scheduleFlush();
  }

  prune(rootKey: string, keep: ReadonlySet<string>): void {
    const bucket = this.data[rootKey];
    if (!bucket) return;
    let changed = false;
    for (const key of Object.keys(bucket)) {
      if (!keep.has(key)) {
        delete bucket[key];
        changed = true;
      }
    }
    if (changed) this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.ctx.globalState.update(CACHE_KEY, this.data);
    }, 2000);
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      void this.ctx.globalState.update(CACHE_KEY, this.data);
    }
  }
}
