import * as vscode from 'vscode';
import * as path from 'node:path';
import { createMatcher } from '../shared/glob';
import type {
  CellValue,
  Config,
  Notice,
  ResolvedField,
  RowData,
  ScopeConfig,
  SortDirection,
  TableStats,
  ViewConfig,
  ViewFilter,
  WebviewToHost,
} from '../shared/types';
import { FILE_COLUMN_KEY } from '../shared/types';
import {
  buildDiscovered,
  defaultConfig,
  loadConfig,
  resolveFields,
  resolveRootUri,
  resolveScopeForView,
  saveConfig,
} from './config';
import { getWebviewHtml } from './html';
import { RowCache, parseFile, readWhole, walkMarkdown, type ScannedRow } from './scanner';
import { buildTable, rowFromScanned } from './tableModel';
import { WriteError, addSkeleton, setFieldValue, type WriteSpec } from './writer';

const REFRESH_DEBOUNCE_MS = 300;
const CONFIG_SAVE_DEBOUNCE_MS = 400;
const CHUNK_SIZE = 500;
const MAX_UNDO = 20;
/** 自己保存配置后的一小段时间内忽略配置文件变更事件，避免自己触发自己重载 */
const SELF_SAVE_GUARD_MS = 2000;

export class TableController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly cache: RowCache;
  private readonly log = vscode.window.createOutputChannel('MatterTable');

  private config: Config | undefined;
  private configUri: vscode.Uri | undefined;
  private rootUri: vscode.Uri | undefined;
  private watchedScanKey: string | undefined;
  private activeViewId: string | undefined;
  private currentScope: ScopeConfig = {};

  private fields: ResolvedField[] = [];
  private fieldMap = new Map<string, ResolvedField>();
  private scanned = new Map<string, ScannedRow>();
  private rows = new Map<string, RowData>();
  private stats: TableStats = { shown: 0, unparsable: 0, withoutFrontmatter: 0 };
  private notices: Notice[] = [];
  private undos: { uri: vscode.Uri; before: string; after: string }[] = [];

  private watchers: vscode.Disposable[] = [];
  private pendingChanges = new Set<string>();
  private pendingDeletes = new Set<string>();
  private changeTimer: NodeJS.Timeout | undefined;
  private saveTimer: NodeJS.Timeout | undefined;
  private lastOwnConfigSave = 0;
  private disposed = false;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.cache = new RowCache(ctx);
    this.disposables.push(this.cache);
    this.disposables.push(this.log);
  }

  private logLine(message: string): void {
    this.log.appendLine(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}`);
  }

  showLog(): void {
    this.log.show(true);
  }

  // ---------------------------------------------------------------- 对外命令

  async open(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn);
      return;
    }
    const panel = vscode.window.createWebviewPanel('mattertable.table', 'MatterTable', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'dist')],
    });
    this.panel = panel;
    panel.webview.html = getWebviewHtml(panel.webview, this.ctx.extensionUri);
    panel.webview.onDidReceiveMessage(
      (msg: WebviewToHost) => {
        void this.onMessage(msg);
      },
      undefined,
      this.disposables,
    );
    panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.disposables,
    );
  }

  async refresh(): Promise<void> {
    if (!this.panel) {
      await this.open();
      return;
    }
    await this.reloadAll();
  }

  async openConfigCommand(): Promise<void> {
    if (!this.configUri) {
      await this.reloadAll();
    }
    if (!this.configUri) return;
    await vscode.window.showTextDocument(this.configUri, { preview: false });
  }

  async undoLastWrite(): Promise<void> {
    const entry = this.undos.pop();
    if (!entry) {
      this.pushNotice('info', '没有可撤销的改动');
      return;
    }
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(entry.uri);
    } catch {
      this.pushNotice('error', '撤销失败：无法读取该文件');
      return;
    }
    if (doc.getText() !== entry.after) {
      this.undos.push(entry);
      this.pushNotice('warn', '该文件在表格改动之后又被修改过，无法自动撤销');
      return;
    }
    if (doc.isDirty) {
      this.undos.push(entry);
      this.pushNotice('warn', '该文件在编辑器里有未保存的改动，请先保存或放弃后再撤销');
      return;
    }
    try {
      await this.applyText(entry.uri, entry.before);
    } catch (err) {
      this.undos.push(entry);
      this.pushNotice('error', `撤销失败：${String((err as Error).message)}`);
      return;
    }
    this.pushNotice('info', `已撤销上一次改动：${path.basename(entry.uri.fsPath)}`);
    await this.reloadAll();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    for (const w of this.watchers) w.dispose();
    this.watchers = [];
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.panel?.dispose();
    this.panel = undefined;
  }

  // ------------------------------------------------------------------ 数据加载

  private async reloadAll(): Promise<void> {
    if (this.disposed) return;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.pushNotice('error', '请先用 Cursor/VSCode 打开一个文件夹，MatterTable 需要工作区来存放配置文件');
      return;
    }
    const loaded = await loadConfig(folder.uri);
    this.config = loaded.config;
    this.configUri = loaded.uri;
    if (loaded.warning) this.pushNotice(loaded.created ? 'info' : 'warn', loaded.warning);

    // 当前视图：配置里记着上次用的是哪个；视图的 hiddenColumns 首次运行时按字段的 visible 固化
    this.activeViewId =
      typeof this.config.activeViewId === 'string' && this.config.views.some((v) => v.id === this.config?.activeViewId)
        ? this.config.activeViewId
        : this.config.views[0].id;
    let seeded = false;
    for (const view of this.config.views) {
      if (!view.hiddenColumns) {
        view.hiddenColumns = this.config.fields.filter((f) => f.visible === false).map((f) => f.key);
        seeded = true;
      }
    }
    if (seeded) await this.persistConfig();

    const scope = resolveScopeForView(this.config, this.currentView());
    this.currentScope = scope;
    const { root, warning } = resolveRootUri(scope, folder);
    if (!root) {
      this.pushNotice('error', warning ?? '无法确定扫描路径');
      return;
    }
    this.rootUri = root;

    const startedAt = Date.now();
    const scanned = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'MatterTable 正在扫描 markdown 文件…' },
      async () => this.scanAll(root, scope),
    );
    if (this.disposed) return;
    this.setupWatchers(root, folder, this.scopeKeyFor(scope));
    this.applyScan(scanned);
    this.logLine(
      `扫描完成：视图「${this.currentView().name}」→ ${root.fsPath} → ${scanned.length} 个文件，` +
        `显示 ${this.rows.size} 行，无前置信息 ${this.stats.withoutFrontmatter}，无法解析 ${this.stats.unparsable}，` +
        `耗时 ${Date.now() - startedAt} ms`,
    );
  }

  private scopeKeyFor(scope: ScopeConfig): string {
    return `${scope.root ?? ''}|${(scope.include ?? []).join(',')}|${(scope.exclude ?? []).join(',')}`;
  }

  private async scanAll(root: vscode.Uri, scope: ScopeConfig): Promise<ScannedRow[]> {
    const files = await walkMarkdown(root, scope.include ?? ['**/*.md'], scope.exclude ?? []);
    const rootKey = root.fsPath;
    const scanned: ScannedRow[] = [];
    for (const file of files) {
      let stat: vscode.FileStat;
      try {
        stat = await vscode.workspace.fs.stat(file.uri);
      } catch {
        continue;
      }
      const cached = this.cache.get(rootKey, file.relPath, stat.mtime, stat.size);
      if (cached) {
        scanned.push({
          uri: file.uri,
          relPath: file.relPath,
          fileName: file.fileName,
          mtime: stat.mtime,
          size: stat.size,
          values: cached.values,
          hasFrontmatter: cached.hasFrontmatter,
          parseError: cached.parseError,
          complexKeys: cached.complexKeys,
        });
        continue;
      }
      try {
        const parsed = await parseFile(file);
        scanned.push(parsed);
        this.cache.set(rootKey, file.relPath, {
          mtime: parsed.mtime,
          size: parsed.size,
          values: parsed.values,
          hasFrontmatter: parsed.hasFrontmatter,
          parseError: parsed.parseError,
          complexKeys: parsed.complexKeys,
        });
      } catch {
        /* 读不了的文件跳过（权限/编码等），不阻塞整体 */
      }
    }
    // 注意：这里**不做 prune**。不同视图的扫描范围可能只是同一个根目录的子集，
    // 按当前扫描结果清理缓存会把别的视图已缓存的解析结果删掉。删除文件由文件监听负责清理。
    return scanned;
  }

  private applyScan(scanned: readonly ScannedRow[]): void {
    if (!this.config) return;
    const showWithout = this.config.settings.showFilesWithoutFrontmatter === true;
    const { fields, rows, stats } = buildTable(this.config, scanned, showWithout);
    this.fields = fields;
    this.fieldMap = new Map(fields.map((f) => [f.key, f]));
    this.scanned = new Map(scanned.map((s) => [s.relPath, s]));
    this.rows = new Map(rows.map((r) => [r.id, r]));
    this.stats = stats;
    void this.sendInit();
  }

  // ------------------------------------------------------------------ 消息收发

  private post(message: unknown): void {
    void this.panel?.webview.postMessage(message);
  }

  private async sendInit(): Promise<void> {
    if (!this.panel) return;
    const rows = [...this.rows.values()];
    this.post({
      type: 'init',
      fields: this.fields,
      view: this.currentView(),
      views: this.config?.views ?? [],
      rows: rows.slice(0, CHUNK_SIZE),
      stats: this.stats,
      chunkSize: CHUNK_SIZE,
      showFilesWithoutFrontmatter: this.config?.settings.showFilesWithoutFrontmatter === true,
      scopeRoot: this.rootUri?.fsPath ?? '',
      configPath: this.configUri?.fsPath ?? '',
      emptyValueStyle: this.config?.settings.emptyValueStyle ?? 'null',
      notices: this.notices.slice(-5),
    });
    for (let offset = CHUNK_SIZE; offset < rows.length; offset += CHUNK_SIZE) {
      const chunk = rows.slice(offset, offset + CHUNK_SIZE);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!this.panel) return;
      this.post({ type: 'rowsChunk', offset, rows: chunk });
    }
  }

  private currentView(): ViewConfig {
    const views = this.config?.views ?? defaultConfig().views;
    const view = views.find((v) => v.id === this.activeViewId) ?? views[0];
    return {
      ...view,
      hiddenColumns: view.hiddenColumns ?? [],
      columnOrder: view.columnOrder ?? this.fields.map((f) => f.key),
      columnWidths: view.columnWidths ?? {},
      filter: view.filter ?? { logic: 'and', conditions: [] },
    };
  }

  /** 当前视图在配置里的原始对象（不带默认值填充），用于就地修改 */
  private currentViewRef(): ViewConfig | undefined {
    const views = this.config?.views;
    if (!views || views.length === 0) return undefined;
    return views.find((v) => v.id === this.activeViewId) ?? views[0];
  }

  private pushNotice(level: Notice['level'], message: string): void {
    const notice: Notice = { level, message };
    this.notices.push(notice);
    if (this.notices.length > 20) this.notices.shift();
    if (this.panel) {
      this.post({ type: 'notice', notice });
    } else if (level === 'error') {
      void vscode.window.showErrorMessage(message);
    }
  }

  private async onMessage(msg: WebviewToHost): Promise<void> {
    try {
      switch (msg.type) {
        case 'ready':
          await this.reloadAll();
          break;
        case 'refresh':
          await this.reloadAll();
          break;
        case 'openConfig':
          await this.openConfigCommand();
          break;
        case 'openFile':
          await this.openFile(msg.id);
          break;
        case 'setCell':
          await this.writeCell(msg.id, msg.key, msg.value);
          break;
        case 'clearCell':
          await this.writeCell(msg.id, msg.key, null);
          break;
        case 'addOption':
          await this.addOption(msg.key, msg.value);
          break;
        case 'addSkeleton':
          await this.backfill(msg.id);
          break;
        case 'setSort':
          await this.setSort(msg.key, msg.direction);
          break;
        case 'setColumnVisible':
          await this.setColumnVisible(msg.key, msg.visible);
          break;
        case 'setColumnOrder':
          await this.patchView({ columnOrder: msg.order });
          break;
        case 'setColumnWidth':
          await this.setColumnWidth(msg.key, msg.width);
          break;
        case 'resetColumnWidths':
          await this.patchView({ columnWidths: {} });
          this.post({ type: 'viewUpdated', view: this.currentView() });
          break;
        case 'toggleShowWithoutFrontmatter':
          await this.toggleShowWithoutFrontmatter(msg.show);
          break;
        case 'switchView':
          await this.switchView(msg.viewId);
          break;
        case 'createView':
          await this.createView(msg.name, msg.copyCurrent, msg.viewType ?? 'table');
          break;
        case 'duplicateView':
          await this.duplicateView(msg.viewId);
          break;
        case 'renameView':
          await this.renameView(msg.viewId, msg.name);
          break;
        case 'deleteView':
          await this.deleteView(msg.viewId);
          break;
        case 'setViewFilter':
          await this.setViewFilter(msg.viewId, msg.filter);
          break;
        case 'setViewDateField':
          await this.setViewDateField(msg.viewId, msg.dateField);
          break;
        case 'setViewScope':
          await this.setViewScope(msg.viewId, msg.scope);
          break;
      }
    } catch (err) {
      this.logLine(`操作失败：${String((err as Error).message)}`);
      this.pushNotice('error', `操作失败：${String((err as Error).message)}`);
    }
  }

  // ------------------------------------------------------------------ 具体动作

  private async openFile(id: string): Promise<void> {
    const scanned = this.scanned.get(id);
    const uri = scanned?.uri ?? this.uriForRelPath(id);
    if (!uri) return;
    await vscode.window.showTextDocument(uri, { preview: false });
  }

  private uriForRelPath(id: string): vscode.Uri | undefined {
    if (!this.rootUri) return undefined;
    return vscode.Uri.joinPath(this.rootUri, ...id.split('/'));
  }

  /** 把改写后的文本写回文件：走 WorkspaceEdit（编辑器里可见、可撤销） */
  private async applyText(uri: vscode.Uri, text: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(uri);
    const full = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, full, text);
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) throw new Error('VSCode 拒绝应用这次编辑');
    await doc.save();
  }

  /** 磁盘落地后的二次校验：换行符/BOM 允许被编辑器规范化，其余必须一致 */
  private async verifyOnDisk(uri: vscode.Uri, expected: string): Promise<string | undefined> {
    try {
      const actual = await readWhole(uri);
      const normalize = (s: string) => s.replace(/^\ufeff/, '').replace(/\r\n/g, '\n');
      if (normalize(actual) !== normalize(expected)) {
        return `${path.basename(uri.fsPath)} 写入后与预期不完全一致，请检查该文件`;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private async writeCell(id: string, key: string, value: CellValue): Promise<void> {
    const row = this.rows.get(id);
    const field = this.fieldMap.get(key);
    const scanned = this.scanned.get(id);
    const original = row?.values[key] ?? null;

    const fail = (message: string, revertTo: CellValue = original) => {
      this.logLine(`拒绝写入 ${id} :: ${key} —— ${message}`);
      this.post({ type: 'cellResult', id, key, value: revertTo, error: message });
    };

    if (!row || !field || !scanned) {
      fail('找不到这一行或这个字段，表格将重新加载');
      await this.reloadAll();
      return;
    }
    if (key === FILE_COLUMN_KEY) {
      fail('文件名不能在这里修改');
      return;
    }
    if (field.complex) {
      fail(`字段 ${key} 是嵌套结构，MatterTable 不支持编辑`);
      return;
    }
    if (!scanned.hasFrontmatter) {
      fail('该文件没有 front matter，请先用行首的「补骨架」按钮添加');
      return;
    }
    if (scanned.parseError) {
      fail(`该文件的 front matter 不是合法 YAML：${scanned.parseError}`);
      return;
    }

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(scanned.uri);
    } catch (err) {
      fail(`无法读取文件：${String((err as Error).message)}`);
      return;
    }
    if (doc.isDirty) {
      fail('该文件在编辑器里有未保存的改动，请先保存（Ctrl+S）再修改');
      return;
    }

    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(scanned.uri);
    } catch (err) {
      fail(`无法读取文件状态：${String((err as Error).message)}`);
      return;
    }
    if (stat.mtime !== scanned.mtime || stat.size !== scanned.size) {
      await this.refreshRows([id]);
      this.pushNotice('warn', `${scanned.fileName} 已被外部修改，表格已刷新，请重新操作`);
      fail('文件已被外部修改', this.rows.get(id)?.values[key] ?? null);
      return;
    }

    const before = doc.getText();
    const spec: WriteSpec = { key, type: field.type, storage: field.storage };
    let after: string;
    try {
      after = setFieldValue(before, spec, value, {
        emptyValueStyle: this.config?.settings.emptyValueStyle ?? 'null',
      });
    } catch (err) {
      fail(err instanceof WriteError ? err.message : `改写失败：${String((err as Error).message)}`);
      return;
    }

    if (after !== before) {
      try {
        await this.applyText(scanned.uri, after);
      } catch (err) {
        fail(`写入失败：${String((err as Error).message)}`);
        return;
      }
      this.undos.push({ uri: scanned.uri, before, after });
      if (this.undos.length > MAX_UNDO) this.undos.shift();
      this.logLine(
        `写入成功 ${id} :: ${key} = ${JSON.stringify(value)}（${before.length} → ${after.length} 字节）`,
      );
      const warning = await this.verifyOnDisk(scanned.uri, after);
      if (warning) {
        this.logLine(`写入后校验告警：${warning}`);
        this.pushNotice('warn', warning);
      }
    }

    await this.refreshRows([id]);
    this.post({ type: 'cellResult', id, key, value: this.rows.get(id)?.values[key] ?? null });
  }

  private async backfill(id: string): Promise<void> {
    const scanned = this.scanned.get(id);
    if (!scanned) return;
    const uri = scanned.uri;
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch (err) {
      this.pushNotice('error', `无法读取文件：${String((err as Error).message)}`);
      return;
    }
    if (doc.isDirty) {
      this.pushNotice('warn', '该文件在编辑器里有未保存的改动，请先保存（Ctrl+S）再补骨架');
      return;
    }
    const before = doc.getText();
    const skeleton = this.config?.skeleton ?? {};
    const keys = skeleton.fields ?? ['title', 'date', 'categories', 'tags', 'state'];
    const specs: WriteSpec[] = [];
    for (const key of keys) {
      const field = this.fieldMap.get(key);
      if (field && !field.complex) specs.push({ key, type: field.type, storage: field.storage });
      else if (!field) specs.push({ key, type: 'text' });
    }
    let after: string;
    try {
      after = addSkeleton(before, specs, {
        autoFillDateToday: skeleton.autoFillDateToday !== false,
        stateDefault: skeleton.stateDefault ?? [],
      });
    } catch (err) {
      this.pushNotice('error', err instanceof WriteError ? err.message : `补骨架失败：${String((err as Error).message)}`);
      return;
    }
    try {
      await this.applyText(uri, after);
    } catch (err) {
      this.pushNotice('error', `写入失败：${String((err as Error).message)}`);
      return;
    }
    this.undos.push({ uri, before, after });
    if (this.undos.length > MAX_UNDO) this.undos.shift();
    this.logLine(`补骨架 ${id}（${before.length} → ${after.length} 字节）`);
    this.pushNotice('info', `已为 ${scanned.fileName} 补上 front matter 骨架`);
    await this.reloadAll();
  }

  private async addOption(key: string, value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed || !this.config) return;
    const field = this.config.fields.find((f) => f.key === key);
    // 只有「手动固定了选项池」的字段需要收编；自动模式的字段重扫后自然就有
    if (field && field.options && field.options.length > 0 && !field.options.includes(trimmed)) {
      field.options = [...field.options, trimmed];
      await this.persistConfig();
    }
    // 只更新字段定义，不做整表重载——否则会把用户正在编辑的单元格和未提交的输入冲掉
    this.refreshFields();
  }

  /** 重新解析字段定义（选项池会随新值变化），但不重新扫描文件、不重置界面状态 */
  private refreshFields(): void {
    if (!this.config) return;
    const discovered = buildDiscovered([...this.scanned.values()]);
    const { fields } = resolveFields(this.config, discovered);
    this.fields = fields;
    this.fieldMap = new Map(fields.map((f) => [f.key, f]));
    this.post({ type: 'fieldsUpdated', fields });
  }

  private async setSort(key: string | null, direction: SortDirection): Promise<void> {
    // 界面已经自己排好序了，这里只需要持久化，不必回传数据（回传会重置滚动与选中）
    await this.patchView({ sort: key ? [{ key, direction }] : [] });
  }

  private async setColumnVisible(key: string, visible: boolean): Promise<void> {
    const view = this.currentView();
    const hidden = new Set(view.hiddenColumns ?? []);
    if (visible) hidden.delete(key);
    else hidden.add(key);
    await this.patchView({ hiddenColumns: [...hidden] });
  }

  private async setColumnWidth(key: string, width: number): Promise<void> {
    const view = this.currentView();
    const widths = { ...(view.columnWidths ?? {}), [key]: Math.max(60, Math.round(width)) };
    await this.patchView({ columnWidths: widths });
  }

  private async toggleShowWithoutFrontmatter(show: boolean): Promise<void> {
    if (!this.config) return;
    this.config.settings.showFilesWithoutFrontmatter = show;
    await this.persistConfig();
    await this.reloadAll();
  }

  private async patchView(patch: Partial<ViewConfig>): Promise<void> {
    const view = this.currentViewRef();
    if (!view) return;
    Object.assign(view, patch);
    this.scheduleSave();
  }

  // ------------------------------------------------------------------ 视图管理

  private postViews(): void {
    if (!this.config || !this.activeViewId) return;
    this.post({ type: 'viewsUpdated', views: this.config.views, currentId: this.activeViewId });
  }

  private async switchView(viewId: string): Promise<void> {
    if (!this.config) return;
    if (!this.config.views.some((v) => v.id === viewId)) return;
    this.config.activeViewId = viewId;
    this.activeViewId = viewId;
    await this.persistConfig();
    const scope = resolveScopeForView(this.config, this.currentView());
    if (this.scopeKeyFor(scope) !== this.scopeKeyFor(this.currentScope)) {
      // 扫描范围不同 → 需要重新走一遍目录（有缓存，只是 stat）
      await this.reloadAll();
      return;
    }
    // 同一个扫描范围 → 行数据已经内存里了，只把新视图的配置推给界面，瞬时完成
    this.currentScope = scope;
    await this.sendInit();
  }

  private newViewId(): string {
    return `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  private async createView(name: string, copyCurrent: boolean, viewType: 'table' | 'calendar' = 'table'): Promise<void> {
    if (!this.config) return;
    const base = copyCurrent ? this.currentViewRef() : undefined;
    const isCalendar = viewType === 'calendar';
    const view: ViewConfig = {
      id: this.newViewId(),
      name: name.trim() !== '' ? name.trim() : isCalendar ? `日历 ${this.config.views.length + 1}` : `视图 ${this.config.views.length + 1}`,
      type: viewType,
      // 日历视图：默认挑第一个 date 类型字段，用户可以再改（绝不硬编码 date）
      dateField: isCalendar ? this.defaultDateFieldKey() : undefined,
      scope: base?.scope ? { ...base.scope } : undefined,
      // 新建视图默认不带筛选条件（复制视图才带）
      filter: { logic: 'and', conditions: [] },
      sort: [],
      hiddenColumns: base?.hiddenColumns ? [...base.hiddenColumns] : undefined,
      columnOrder: base?.columnOrder ? [...base.columnOrder] : undefined,
      columnWidths: { ...(base?.columnWidths ?? {}) },
    };
    this.config.views.push(view);
    this.config.activeViewId = view.id;
    this.activeViewId = view.id;
    await this.persistConfig();
    this.pushNotice('info', `已创建${isCalendar ? '日历' : ''}视图「${view.name}」`);
    await this.reloadAll();
  }

  /** 默认的日期字段：取第一个声明的 date 类型字段 */
  private defaultDateFieldKey(): string | undefined {
    return this.fields.find((f) => f.type === 'date' && !f.complex)?.key;
  }

  private async setViewDateField(viewId: string, dateField: string): Promise<void> {
    if (!this.config) return;
    const view = this.config.views.find((v) => v.id === viewId);
    if (!view) return;
    view.dateField = dateField.trim() === '' ? undefined : dateField.trim();
    await this.persistConfig();
    this.postViews();
  }

  private async duplicateView(viewId: string): Promise<void> {
    if (!this.config) return;
    const source = this.config.views.find((v) => v.id === viewId);
    if (!source) return;
    const copy: ViewConfig = {
      ...source,
      id: this.newViewId(),
      name: `${source.name} 副本`,
      scope: source.scope ? { ...source.scope } : undefined,
      filter: {
        logic: source.filter?.logic ?? 'and',
        conditions: (source.filter?.conditions ?? []).map((c) => ({ ...c, id: `${c.id}-copy` })),
      },
      sort: [...(source.sort ?? [])],
      hiddenColumns: source.hiddenColumns ? [...source.hiddenColumns] : undefined,
      columnOrder: source.columnOrder ? [...source.columnOrder] : undefined,
      columnWidths: { ...(source.columnWidths ?? {}) },
    };
    this.config.views.push(copy);
    await this.persistConfig();
    this.pushNotice('info', `已复制视图「${source.name}」`);
    this.postViews();
  }

  private async renameView(viewId: string, name: string): Promise<void> {
    if (!this.config) return;
    const view = this.config.views.find((v) => v.id === viewId);
    if (!view) return;
    const trimmed = name.trim();
    if (trimmed === '') return;
    view.name = trimmed;
    await this.persistConfig();
    this.postViews();
    if (viewId === this.activeViewId) await this.sendInit();
  }

  private async deleteView(viewId: string): Promise<void> {
    if (!this.config) return;
    if (this.config.views.length <= 1) {
      this.pushNotice('warn', '至少要保留一个视图');
      return;
    }
    const index = this.config.views.findIndex((v) => v.id === viewId);
    if (index < 0) return;
    const [removed] = this.config.views.splice(index, 1);
    const wasActive = viewId === this.activeViewId;
    if (wasActive) {
      const next = this.config.views[Math.max(0, index - 1)];
      this.config.activeViewId = next.id;
      this.activeViewId = next.id;
    }
    await this.persistConfig();
    this.pushNotice('info', `已删除视图「${removed.name}」`);
    if (wasActive) {
      await this.reloadAll();
      return;
    }
    this.postViews();
  }

  private async setViewFilter(viewId: string, filter: ViewFilter): Promise<void> {
    if (!this.config) return;
    const view = this.config.views.find((v) => v.id === viewId);
    if (!view) return;
    view.filter = { logic: filter.logic === 'or' ? 'or' : 'and', conditions: filter.conditions ?? [] };
    // 筛选在界面上完成，这里只需要持久化；不用回传数据，避免打断用户正在输入的条件
    this.scheduleSave();
  }

  private async setViewScope(viewId: string, scope: ScopeConfig): Promise<void> {
    if (!this.config) return;
    const view = this.config.views.find((v) => v.id === viewId);
    if (!view) return;
    const cleaned: ScopeConfig = {};
    if (typeof scope.root === 'string' && scope.root.trim() !== '') cleaned.root = scope.root.trim();
    if (Array.isArray(scope.include) && scope.include.length > 0) cleaned.include = scope.include.filter((s) => s.trim() !== '');
    if (Array.isArray(scope.exclude) && scope.exclude.length > 0) cleaned.exclude = scope.exclude.filter((s) => s.trim() !== '');
    view.scope = Object.keys(cleaned).length > 0 ? cleaned : undefined;
    await this.persistConfig();
    this.pushNotice('info', '视图的扫描范围已更新，正在重新扫描…');
    await this.reloadAll();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.persistConfig();
    }, CONFIG_SAVE_DEBOUNCE_MS);
  }

  private async persistConfig(): Promise<void> {
    if (!this.config || !this.configUri) return;
    this.lastOwnConfigSave = Date.now();
    try {
      await saveConfig(this.configUri, this.config);
    } catch (err) {
      this.pushNotice('error', `配置保存失败：${String((err as Error).message)}`);
    }
  }

  // ------------------------------------------------------------------ 增量刷新

  private async refreshRows(ids: readonly string[]): Promise<void> {
    if (!this.config || !this.rootUri) return;
    const showWithout = this.config.settings.showFilesWithoutFrontmatter === true;
    const rootKey = this.rootUri.fsPath;
    const updated: RowData[] = [];
    const removedIds: string[] = [];

    for (const id of ids) {
      const uri = this.scanned.get(id)?.uri ?? this.uriForRelPath(id);
      if (!uri) continue;
      try {
        const parsed = await parseFile({ uri, relPath: id, fileName: id.split('/').pop() ?? id });
        this.scanned.set(id, parsed);
        this.cache.set(rootKey, id, {
          mtime: parsed.mtime,
          size: parsed.size,
          values: parsed.values,
          hasFrontmatter: parsed.hasFrontmatter,
          parseError: parsed.parseError,
          complexKeys: parsed.complexKeys,
        });
        if (parsed.hasFrontmatter || showWithout) {
          const row = rowFromScanned(parsed, this.fields);
          this.rows.set(id, row);
          updated.push(row);
        } else if (this.rows.delete(id)) {
          removedIds.push(id);
        }
      } catch {
        if (this.rows.delete(id)) removedIds.push(id);
        this.scanned.delete(id);
        this.cache.remove(rootKey, id);
      }
    }

    this.stats = this.recomputeStats();
    if (updated.length > 0 || removedIds.length > 0) {
      this.post({ type: 'rowsUpdated', rows: updated, removedIds, stats: this.stats });
    }
  }

  private recomputeStats(): TableStats {
    let unparsable = 0;
    let withoutFrontmatter = 0;
    for (const row of this.scanned.values()) {
      if (row.parseError) unparsable++;
      if (!row.hasFrontmatter) withoutFrontmatter++;
    }
    return {
      shown: this.rows.size,
      unparsable,
      withoutFrontmatter,
      optionsTruncated: this.stats.optionsTruncated,
    };
  }

  // ------------------------------------------------------------------ 文件监听

  private setupWatchers(root: vscode.Uri, folder: vscode.WorkspaceFolder, scanKey: string): void {
    if (this.watchedScanKey === scanKey && this.watchers.length > 0) return;
    this.watchedScanKey = scanKey;
    for (const w of this.watchers) w.dispose();
    this.watchers = [];

    const mdWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*.md'));
    mdWatcher.onDidChange((uri) => this.onFileEvent(uri, 'change'));
    mdWatcher.onDidCreate((uri) => this.onFileEvent(uri, 'create'));
    mdWatcher.onDidDelete((uri) => this.onFileEvent(uri, 'delete'));
    this.watchers.push(mdWatcher);

    const configWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, '.mattertable/config.json'),
    );
    const onConfigChanged = () => {
      if (Date.now() - this.lastOwnConfigSave < SELF_SAVE_GUARD_MS) return;
      void this.reloadAll();
    };
    configWatcher.onDidChange(onConfigChanged);
    configWatcher.onDidCreate(onConfigChanged);
    this.watchers.push(configWatcher);
  }

  private onFileEvent(uri: vscode.Uri, kind: 'change' | 'create' | 'delete'): void {
    if (!this.rootUri || !this.config) return;
    const rel = path.relative(this.rootUri.fsPath, uri.fsPath).replace(/\\/g, '/');
    if (rel === '' || rel.startsWith('..')) return;
    const include = this.currentScope.include ?? ['**/*.md'];
    const exclude = this.currentScope.exclude ?? [];
    if (createMatcher(exclude)(rel) || !createMatcher(include)(rel)) return;
    if (kind === 'delete') this.pendingDeletes.add(rel);
    else this.pendingChanges.add(rel);
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => {
      this.changeTimer = undefined;
      void this.flushFileEvents();
    }, REFRESH_DEBOUNCE_MS);
  }

  private async flushFileEvents(): Promise<void> {
    const changed = [...this.pendingChanges];
    const deleted = [...this.pendingDeletes];
    this.pendingChanges.clear();
    this.pendingDeletes.clear();
    const rootKey = this.rootUri?.fsPath;
    for (const id of deleted) {
      this.rows.delete(id);
      this.scanned.delete(id);
      if (rootKey) this.cache.remove(rootKey, id);
    }
    if (changed.length > 0) {
      await this.refreshRows(changed);
      return;
    }
    if (deleted.length > 0) {
      this.stats = this.recomputeStats();
      this.post({ type: 'rowsUpdated', rows: [], removedIds: deleted, stats: this.stats });
    }
  }
}
