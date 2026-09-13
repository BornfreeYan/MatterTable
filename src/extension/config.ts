import * as vscode from 'vscode';
import * as path from 'node:path';
import { fileColumnField } from '../shared/sort';
import type {
  CellValue,
  Config,
  FieldDef,
  FieldType,
  FilterCondition,
  FilterOperator,
  ResolvedField,
  ScopeConfig,
  ViewConfig,
} from '../shared/types';
import { FILE_COLUMN_KEY } from '../shared/types';

export const CONFIG_DIR = '.mattertable';
export const CONFIG_FILE = 'config.json';
export const CACHE_KEY = 'mattertable.rowCache.v1';

/** 选项池上限，避免脏数据把界面撑爆 */
const MAX_OPTIONS = 500;

/**
 * 默认忽略清单。前几项是通用噪音，后面几项针对本知识库的实际情况：
 * `20 Raw` / `30 Raw` 下是第三方仓库克隆（实测 614 个 markdown），
 * `5 Projects` 下是代码仓库（含 MatterTable 自己与博客仓库的已发布副本）。
 */
const DEFAULT_EXCLUDE = [
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

export function defaultConfig(): Config {
  return {
    version: 1,
    scope: { include: ['**/*.md'], exclude: [...DEFAULT_EXCLUDE] },
    settings: {
      emptyValueStyle: 'null',
      dateFormat: 'YYYY-MM-DD',
      showFilesWithoutFrontmatter: false,
    },
    fields: [
      { key: 'title', type: 'text', label: '标题', width: 260, visible: true, order: 1 },
      { key: 'date', type: 'date', label: '日期', width: 130, visible: true, order: 2 },
      {
        key: 'categories',
        type: 'select',
        storage: 'list',
        label: '分类',
        options: [],
        width: 150,
        visible: true,
        order: 3,
      },
      { key: 'tags', type: 'multiSelect', label: '标签', width: 220, visible: true, order: 4 },
      {
        key: 'state',
        type: 'select',
        storage: 'list',
        label: '状态',
        options: ['not started', 'finished'],
        width: 130,
        visible: true,
        order: 5,
      },
      { key: 'description', type: 'text', label: '摘要', width: 280, visible: false, order: 6 },
    ],
    skeleton: {
      fields: ['title', 'date', 'categories', 'tags', 'state'],
      autoFillDateToday: true,
      stateDefault: ['not started'],
    },
    views: [
      {
        id: 'default',
        name: '全部笔记',
        type: 'table',
        filter: { logic: 'and', conditions: [] },
        sort: [],
        hiddenColumns: ['description'],
        columnWidths: {},
      },
    ],
    activeViewId: 'default',
  };
}

export function configUriFor(root: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(root, CONFIG_DIR, CONFIG_FILE);
}

function isFieldType(v: unknown): v is FieldType {
  return v === 'text' || v === 'number' || v === 'checkbox' || v === 'date' || v === 'select' || v === 'multiSelect';
}

function sanitizeFields(input: unknown): FieldDef[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: FieldDef[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as Partial<FieldDef>;
    if (typeof f.key !== 'string' || f.key.trim() === '') continue;
    out.push({
      key: f.key,
      type: isFieldType(f.type) ? f.type : 'text',
      label: typeof f.label === 'string' ? f.label : undefined,
      storage: f.storage === 'scalar' ? 'scalar' : f.storage === 'list' ? 'list' : undefined,
      options: Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === 'string') : undefined,
      visible: typeof f.visible === 'boolean' ? f.visible : undefined,
      width: typeof f.width === 'number' && f.width > 0 ? f.width : undefined,
      order: typeof f.order === 'number' ? f.order : undefined,
    });
  }
  return out.length > 0 ? out : undefined;
}

function isFilterOperator(value: unknown): value is FilterOperator {
  return (
    value === 'equals' ||
    value === 'notEquals' ||
    value === 'contains' ||
    value === 'notContains' ||
    value === 'gt' ||
    value === 'lt' ||
    value === 'isEmpty' ||
    value === 'isNotEmpty'
  );
}

function normalizeCondition(input: unknown): FilterCondition | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const condition = input as Partial<FilterCondition>;
  if (typeof condition.key !== 'string' || condition.key.trim() === '') return undefined;
  if (!isFilterOperator(condition.operator)) return undefined;
  const value = condition.value;
  return {
    id: typeof condition.id === 'string' && condition.id !== '' ? condition.id : `c-${condition.key}-${Math.random().toString(36).slice(2, 7)}`,
    key: condition.key,
    operator: condition.operator,
    value: typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null,
  };
}

function normalizeView(input: unknown, index: number): ViewConfig {
  const view = (input && typeof input === 'object' ? input : {}) as Partial<ViewConfig>;
  const rawConditions = Array.isArray(view.filter?.conditions) ? view.filter.conditions : [];
  return {
    id: typeof view.id === 'string' && view.id !== '' ? view.id : `view-${index + 1}`,
    name: typeof view.name === 'string' && view.name.trim() !== '' ? view.name : `视图 ${index + 1}`,
    type: view.type === 'calendar' ? 'calendar' : 'table',
    dateField: typeof view.dateField === 'string' && view.dateField !== '' ? view.dateField : undefined,
    scope: view.scope && typeof view.scope === 'object' ? view.scope : undefined,
    filter: {
      logic: view.filter?.logic === 'or' ? 'or' : 'and',
      conditions: rawConditions.map(normalizeCondition).filter((c): c is FilterCondition => c !== undefined),
    },
    sort: Array.isArray(view.sort) ? view.sort.filter((s) => s && typeof s.key === 'string') : [],
    hiddenColumns: Array.isArray(view.hiddenColumns) ? view.hiddenColumns.filter((k) => typeof k === 'string') : undefined,
    columnOrder: Array.isArray(view.columnOrder) ? view.columnOrder.filter((k) => typeof k === 'string') : undefined,
    columnWidths: view.columnWidths && typeof view.columnWidths === 'object' ? view.columnWidths : {},
  };
}

export function normalizeViews(input: unknown): ViewConfig[] {
  const list = Array.isArray(input) ? input.map((view, index) => normalizeView(view, index)) : [];
  if (list.length === 0) return defaultConfig().views;
  const seen = new Set<string>();
  for (const view of list) {
    let id = view.id;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${view.id}-${suffix++}`;
    }
    view.id = id;
    seen.add(id);
  }
  return list;
}

/** 视图级扫描范围与全局范围合并：exclude 取并集（视图只能加忽略，不能取消全局忽略） */
export function resolveScopeForView(config: Config, view: ViewConfig | undefined): ScopeConfig {
  const base = config.scope ?? {};
  const override = view?.scope ?? {};
  const root = typeof override.root === 'string' && override.root.trim() !== '' ? override.root.trim() : base.root;
  const include = override.include && override.include.length > 0 ? override.include : (base.include ?? ['**/*.md']);
  return { root, include, exclude: [...(base.exclude ?? []), ...(override.exclude ?? [])] };
}

function mergeConfig(input: Partial<Config>): Config {
  const def = defaultConfig();
  const fields = sanitizeFields(input.fields);
  const views = normalizeViews(input.views);
  const activeViewId =
    typeof input.activeViewId === 'string' && views.some((v) => v.id === input.activeViewId)
      ? input.activeViewId
      : views[0].id;
  return {
    version: typeof input.version === 'number' ? input.version : def.version,
    scope: { ...def.scope, ...(input.scope ?? {}) },
    settings: { ...def.settings, ...(input.settings ?? {}) },
    fields: fields ?? def.fields,
    skeleton: { ...def.skeleton, ...(input.skeleton ?? {}) },
    views,
    activeViewId,
  };
}

export interface LoadedConfig {
  config: Config;
  uri: vscode.Uri;
  created: boolean;
  warning?: string;
}

export async function loadConfig(root: vscode.Uri): Promise<LoadedConfig> {
  const uri = configUriFor(root);
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    const parsed = JSON.parse(text) as Partial<Config>;
    return { config: mergeConfig(parsed), uri, created: false };
  } catch (err) {
    const notFound = err instanceof vscode.FileSystemError && err.code === 'FileNotFound';
    if (notFound) {
      const config = defaultConfig();
      await saveConfig(uri, config);
      return {
        config,
        uri,
        created: true,
        warning: `已创建默认配置文件 .mattertable/config.json，可在表格右上角「配置」里打开修改`,
      };
    }
    return {
      config: defaultConfig(),
      uri,
      created: false,
      warning: `配置文件解析失败，已回退到默认配置：${String((err as Error).message).slice(0, 200)}`,
    };
  }
}

export async function saveConfig(uri: vscode.Uri, config: Config): Promise<void> {
  const dir = vscode.Uri.joinPath(uri, '..');
  try {
    await vscode.workspace.fs.createDirectory(dir);
  } catch {
    /* 目录已存在 */
  }
  const text = JSON.stringify(config, null, 2) + '\n';
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
}

export function resolveRootUri(
  scope: ScopeConfig,
  folder: vscode.WorkspaceFolder | undefined,
): { root?: vscode.Uri; warning?: string } {
  const configured = scope.root;
  if (typeof configured === 'string' && configured.trim() !== '') {
    return { root: vscode.Uri.file(path.resolve(configured.trim())) };
  }
  if (folder) return { root: folder.uri };
  return { warning: '当前没有打开任何文件夹，且配置里没有指定 scope.root' };
}

export interface DiscoveredField {
  key: string;
  values: CellValue[];
  complex: boolean;
}

export function buildDiscovered(
  scanned: readonly { values: Record<string, CellValue>; complexKeys: readonly string[] }[],
): Map<string, DiscoveredField> {
  const map = new Map<string, DiscoveredField>();
  for (const row of scanned) {
    for (const [key, value] of Object.entries(row.values)) {
      let entry = map.get(key);
      if (!entry) {
        entry = { key, values: [], complex: false };
        map.set(key, entry);
      }
      entry.values.push(value);
    }
    for (const key of row.complexKeys) {
      let entry = map.get(key);
      if (!entry) {
        entry = { key, values: [], complex: false };
        map.set(key, entry);
      }
      entry.complex = true;
    }
  }
  return map;
}

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

/** 自动模式：把扫描到的不同取值收集成选项池，按出现次数降序、次数相同按名称 */
function autoOptions(values: readonly CellValue[]): { options: string[]; truncated: boolean } {
  const freq = new Map<string, number>();
  for (const v of values) {
    const items = Array.isArray(v) ? v : v === null || v === '' ? [] : [String(v)];
    for (const item of items) freq.set(item, (freq.get(item) ?? 0) + 1);
  }
  let options = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))
    .map(([key]) => key);
  let truncated = false;
  if (options.length > MAX_OPTIONS) {
    options = options.slice(0, MAX_OPTIONS);
    truncated = true;
  }
  return { options, truncated };
}

function inferType(values: readonly CellValue[], complex: boolean): FieldType {
  if (complex) return 'text';
  let hasArray = false;
  let hasNumber = false;
  let hasBoolean = false;
  let hasString = false;
  let hasDate = false;
  let count = 0;
  for (const v of values) {
    if (v === null || v === '') continue;
    count++;
    if (Array.isArray(v)) hasArray = true;
    else if (typeof v === 'number') hasNumber = true;
    else if (typeof v === 'boolean') hasBoolean = true;
    else if (typeof v === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) hasDate = true;
      else hasString = true;
    }
  }
  if (count === 0) return 'text';
  if (hasArray) return 'multiSelect';
  if (hasString) return 'text';
  if (hasDate) return 'date';
  if (hasNumber) return 'number';
  if (hasBoolean) return 'checkbox';
  return 'text';
}

export function resolveFields(
  config: Config,
  discovered: Map<string, DiscoveredField>,
): { fields: ResolvedField[]; optionsTruncated: boolean } {
  const out: ResolvedField[] = [{ ...fileColumnField }];
  const used = new Set<string>([FILE_COLUMN_KEY]);
  let optionsTruncated = false;

  const configured = config.fields
    .map((field, index) => ({ field, index }))
    .sort((a, b) => (a.field.order ?? 100 + a.index) - (b.field.order ?? 100 + b.index));

  for (const { field, index } of configured) {
    if (used.has(field.key)) continue;
    used.add(field.key);
    const disc = discovered.get(field.key);
    const pinned = (field.options ?? []).filter((o) => o.trim() !== '');
    let options = pinned;
    let optionsAuto = false;
    if (pinned.length === 0) {
      const auto = autoOptions(disc?.values ?? []);
      options = auto.options;
      optionsAuto = true;
      optionsTruncated = optionsTruncated || auto.truncated;
    }
    out.push({
      key: field.key,
      type: field.type,
      label: field.label && field.label.trim() !== '' ? field.label : field.key,
      storage: field.storage ?? 'list',
      options,
      optionsAuto,
      visible: field.visible !== false,
      width: field.width && field.width > 0 ? field.width : 160,
      order: field.order ?? 100 + index,
      complex: disc?.complex ?? false,
      source: 'config',
    });
  }

  let extra = 1000;
  for (const [key, disc] of discovered) {
    if (used.has(key)) continue;
    used.add(key);
    const auto = autoOptions(disc.values);
    optionsTruncated = optionsTruncated || auto.truncated;
    out.push({
      key,
      type: inferType(disc.values, disc.complex),
      label: key,
      storage: 'list',
      options: auto.options,
      optionsAuto: true,
      // 嵌套结构（hero / sitemap 之类）默认隐藏
      visible: !disc.complex,
      width: 160,
      order: extra++,
      complex: disc.complex,
      source: 'inferred',
    });
  }

  out.sort((a, b) => a.order - b.order);
  return { fields: out, optionsTruncated };
}
