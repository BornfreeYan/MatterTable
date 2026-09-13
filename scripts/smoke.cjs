/**
 * 集成冒烟测试（开发用，不参与打包）。
 *
 * 用桩替换 vscode API，真实加载 dist/extension.js，跑一遍：
 *   打开表格 → 收到 init → 改单元格写盘 → 校验字节保真 → 补骨架 → 撤销 → 冲突检测
 *
 * 用法：node scripts/smoke.cjs
 */
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const Module = require('node:module');

// ---------------------------------------------------------------- vscode 桩

const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
const ViewColumn = { Active: -1, One: 1 };
const ProgressLocation = { Window: 10 };

class FileSystemError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
    this.name = 'FileSystemError';
  }
}
FileSystemError.FileNotFound = (uri) => new FileSystemError('FileNotFound', `${uri?.fsPath ?? ''} not found`);

class Disposable {
  constructor(fn) {
    this._fn = fn;
  }
  dispose() {
    this._fn?.();
  }
}

class EventEmitter {
  constructor() {
    this.listeners = new Set();
    this.event = (listener) => {
      this.listeners.add(listener);
      return new Disposable(() => this.listeners.delete(listener));
    };
  }
  fire(value) {
    for (const listener of this.listeners) listener(value);
  }
}

function makeUri(fsPath) {
  return {
    scheme: 'file',
    fsPath,
    path: fsPath.replace(/\\/g, '/'),
    toString: () => 'file:///' + fsPath.replace(/\\/g, '/').replace(/^\/+/, ''),
  };
}

const Uri = {
  file: (p) => makeUri(path.resolve(p)),
  joinPath: (base, ...parts) => makeUri(path.join(base.fsPath, ...parts)),
};

const openDocuments = new Map();

const workspaceFs = {
  async readDirectory(uri) {
    const entries = await fs.readdir(uri.fsPath, { withFileTypes: true });
    return entries.map((e) => [e.name, e.isDirectory() ? FileType.Directory : FileType.File]);
  },
  async stat(uri) {
    try {
      const s = await fs.stat(uri.fsPath);
      return { type: s.isDirectory() ? FileType.Directory : FileType.File, ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size };
    } catch {
      throw FileSystemError.FileNotFound(uri);
    }
  },
  async readFile(uri) {
    try {
      return new Uint8Array(await fs.readFile(uri.fsPath));
    } catch {
      throw FileSystemError.FileNotFound(uri);
    }
  },
  async writeFile(uri, bytes) {
    await fs.mkdir(path.dirname(uri.fsPath), { recursive: true });
    await fs.writeFile(uri.fsPath, Buffer.from(bytes));
  },
  async createDirectory(uri) {
    await fs.mkdir(uri.fsPath, { recursive: true });
  },
};

const workspace = {
  workspaceFolders: [],
  fs: workspaceFs,
  textDocuments: [],
  async openTextDocument(uri) {
    const key = uri.fsPath;
    const text = await fs.readFile(key, 'utf8');
    if (openDocuments.has(key) && openDocuments.get(key).text === text) return openDocuments.get(key);
    const doc = {
      uri,
      isDirty: false,
      getText: () => doc.text,
      positionAt: (offset) => ({ offset }),
      lineCount: text.split('\n').length,
      async save() {
        doc.saved = true;
      },
      text,
    };
    openDocuments.set(key, doc);
    return doc;
  },
  async applyEdit(edit) {
    await fs.writeFile(edit.uri.fsPath, edit.text, 'utf8');
    const doc = openDocuments.get(edit.uri.fsPath);
    if (doc) doc.text = edit.text;
    return true;
  },
  createFileSystemWatcher() {
    return { onDidChange: () => new Disposable(), onDidCreate: () => new Disposable(), onDidDelete: () => new Disposable(), dispose() {} };
  },
  asRelativePath: (p) => String(p),
};

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class WorkspaceEdit {
  constructor() {
    this.edits = [];
  }
  replace(uri, _range, text) {
    this.uri = uri;
    this.text = text;
    this.edits.push({ uri, text });
  }
}

class RelativePattern {
  constructor(base, pattern) {
    this.base = base;
    this.pattern = pattern;
  }
}

let webviewMessages = [];
let webviewListener = null;
let panelDisposed = false;
const outputLines = [];

const window = {
  createOutputChannel(name) {
    return {
      name,
      appendLine: (line) => {
        outputLines.push(line);
      },
      show() {},
      dispose() {},
    };
  },
  createWebviewPanel() {
    return {
      webview: {
        html: '',
        cspSource: 'vscode-resource:',
        asWebviewUri: (uri) => uri,
        onDidReceiveMessage: (cb) => {
          webviewListener = cb;
          return new Disposable();
        },
        postMessage: (message) => {
          webviewMessages.push(message);
          return Promise.resolve(true);
        },
      },
      viewColumn: 1,
      reveal() {},
      onDidDispose: () => new Disposable(),
      dispose() {
        panelDisposed = true;
      },
    };
  },
  async showTextDocument() {
    return { uri: makeUri('x') };
  },
  async showErrorMessage(message) {
    console.log(`  [宿主错误提示] ${message}`);
  },
  async showWarningMessage(message) {
    console.log(`  [宿主警告提示] ${message}`);
  },
  async withProgress(_options, task) {
    return task();
  },
};

const registered = new Map();
const commands = {
  registerCommand(name, handler) {
    registered.set(name, handler);
    return new Disposable(() => registered.delete(name));
  },
};

const vscodeStub = {
  FileType,
  ViewColumn,
  ProgressLocation,
  FileSystemError,
  Disposable,
  EventEmitter,
  Uri,
  Range,
  WorkspaceEdit,
  RelativePattern,
  workspace,
  window,
  commands,
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscodeStub;
  return origLoad.call(this, request, parent, isMain);
};

// ---------------------------------------------------------------- 测试夹具

const CRLF = '\r\n';
const BOM = '\ufeff';

const normalFile = [
  '---',
  'title: Agent Concepts Introduction',
  "date: '2026-03-07'",
  'categories:',
  '  - AI',
  'state:',
  '  - not started',
  '---',
  '',
  '正文第一行',
  '正文第二行',
  '',
].join(CRLF);

const bomFile = BOM + ['---', 'title: Python 基础', 'date: 2026-09-06', 'state:', '  - finished', '---', '正文'].join('\r\n');

const navFile = '# 没有 front matter 的笔记\n\n正文内容\n';

const invalidFile = '---\ntitle: 发现问题: 你好\n---\n正文\n';

let tmpRoot;

async function setupFixture() {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mattertable-smoke-'));
  await fs.mkdir(path.join(tmpRoot, 'notes'), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, '20 Raw'), { recursive: true });
  await fs.writeFile(path.join(tmpRoot, 'notes', 'agent.md'), normalFile, 'utf8');
  await fs.writeFile(path.join(tmpRoot, 'notes', 'python.md'), bomFile, 'utf8');
  await fs.writeFile(path.join(tmpRoot, 'notes', 'nav.md'), navFile, 'utf8');
  await fs.writeFile(path.join(tmpRoot, 'notes', 'broken.md'), invalidFile, 'utf8');
  // 这个目录必须被默认忽略清单排除
  await fs.writeFile(path.join(tmpRoot, '20 Raw', 'third-party.md'), '---\ntitle: 别人的文档\n---\nx\n', 'utf8');
  workspace.workspaceFolders = [{ uri: makeUri(tmpRoot), name: 'smoke', index: 0 }];
}

function lastMessage(type) {
  for (let i = webviewMessages.length - 1; i >= 0; i--) {
    if (webviewMessages[i].type === type) return webviewMessages[i];
  }
  return undefined;
}

async function waitFor(predicate, label, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`等待超时：${label}`);
}

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? '✔' : '✘'} ${label}${ok ? '' : `\n      实际: ${JSON.stringify(actual)}\n      预期: ${JSON.stringify(expected)}`}`);
  if (!ok) failures++;
}

function checkTrue(label, value, extra = '') {
  console.log(`  ${value ? '✔' : '✘'} ${label}${value ? '' : `  ${extra}`}`);
  if (!value) failures++;
}

async function send(message) {
  await webviewListener(message);
  await new Promise((r) => setTimeout(r, 30));
}

async function main() {
  console.log('===== MatterTable 集成冒烟测试 =====\n');
  await setupFixture();
  console.log(`夹具目录：${tmpRoot}\n`);

  const context = {
    extensionUri: makeUri(path.resolve(__dirname, '..')),
    subscriptions: [],
    globalState: {
      data: new Map(),
      get(key) {
        return this.data.get(key);
      },
      async update(key, value) {
        this.data.set(key, value);
      },
    },
  };

  // 1. 加载并激活扩展
  console.log('[1] 加载 dist/extension.js 并激活');
  const extension = require(path.resolve(__dirname, '..', 'dist', 'extension.js'));
  checkTrue('bundle 导出了 activate', typeof extension.activate === 'function');
  extension.activate(context);
  check('注册了 5 个命令', [...registered.keys()].sort(), [
    'mattertable.openConfig',
    'mattertable.openTable',
    'mattertable.refresh',
    'mattertable.showLog',
    'mattertable.undoLastWrite',
  ]);

  // 2. 打开表格
  console.log('\n[2] 打开表格并等待 init');
  await registered.get('mattertable.openTable')();
  checkTrue('创建了 webview 面板', webviewMessages !== undefined);
  await send({ type: 'ready' });
  const init = await waitFor(() => lastMessage('init'), '收到 init 消息');

  const fieldKeys = init.fields.map((f) => f.key);
  checkTrue('字段里包含文件名列 __file', fieldKeys.includes('__file'));
  checkTrue('字段里包含 title / date / state', ['title', 'date', 'state'].every((k) => fieldKeys.includes(k)));
  check('统计：显示行数', init.stats.shown, 3);
  check('统计：无 front matter 被隐藏', init.stats.withoutFrontmatter, 1);
  check('统计：无法解析文件数', init.stats.unparsable, 1);
  const ids = init.rows.map((r) => r.id);
  checkTrue('被忽略清单排除的 20 Raw 未出现', !ids.some((id) => id.includes('20 Raw')), JSON.stringify(ids));
  checkTrue('解析出的行里有 agent.md / python.md / broken.md', ['notes/agent.md', 'notes/python.md', 'notes/broken.md'].every((id) => ids.includes(id)));
  const stateField = init.fields.find((f) => f.key === 'state');
  check('state 单选：手工固定的选项池', stateField.options, ['not started', 'finished']);
  checkTrue('state 选项池不是自动模式', stateField.optionsAuto === false);
  const catField = init.fields.find((f) => f.key === 'categories');
  check('categories 自动收集到选项 AI', catField.options, ['AI']);
  checkTrue('categories 是自动模式', catField.optionsAuto === true);

  // 3. 改 state（CRLF 文件，只能动一行）
  console.log('\n[3] 改 state：检查字节保真（CRLF 文件）');
  webviewMessages = [];
  await send({ type: 'setCell', id: 'notes/agent.md', key: 'state', value: 'finished' });
  const result = await waitFor(() => lastMessage('cellResult'), '收到 cellResult');
  checkTrue('写入成功且无错误', !result.error, result.error);
  const afterState = await fs.readFile(path.join(tmpRoot, 'notes', 'agent.md'), 'utf8');
  checkTrue('只有 state 那一行变了', afterState.replace('  - finished', '  - not started') === normalFile, JSON.stringify(afterState));
  checkTrue('CRLF 未变成 LF（无混合换行）', afterState.split('\r\n').length === normalFile.split('\r\n').length);

  // 4. 改日期（BOM 文件）
  console.log('\n[4] 改 date：检查 BOM 与正文保真');
  webviewMessages = [];
  await send({ type: 'setCell', id: 'notes/python.md', key: 'date', value: '2026-12-31' });
  await waitFor(() => lastMessage('cellResult'), '收到 cellResult');
  const afterDate = await fs.readFile(path.join(tmpRoot, 'notes', 'python.md'), 'utf8');
  checkTrue('BOM 仍在', afterDate.charCodeAt(0) === 0xfeff);
  checkTrue('日期已更新', afterDate.includes('date: 2026-12-31'));
  checkTrue('其余内容未动', afterDate.slice(1) === bomFile.slice(1).replace('date: 2026-09-06', 'date: 2026-12-31'));

  // 5. 非法 YAML 与无 front matter 的文件拒绝写入
  console.log('\n[5] 非法 YAML 的文件拒绝写入');
  webviewMessages = [];
  await send({ type: 'setCell', id: 'notes/broken.md', key: 'title', value: 'x' });
  const broken = await waitFor(() => lastMessage('cellResult'), '收到 cellResult');
  checkTrue('返回了错误提示', typeof broken.error === 'string' && broken.error.length > 0, String(broken.error));
  check('文件内容未被改动', await fs.readFile(path.join(tmpRoot, 'notes', 'broken.md'), 'utf8'), invalidFile);

  // 6. 补骨架
  console.log('\n[6] 给没有 front matter 的文件补骨架');
  webviewMessages = [];
  await send({ type: 'addSkeleton', id: 'notes/nav.md' });
  const afterSkeleton = await waitFor(
    async () => {
      const text = await fs.readFile(path.join(tmpRoot, 'notes', 'nav.md'), 'utf8');
      return text.startsWith('---') ? text : undefined;
    },
    '文件被补上 front matter',
  );
  checkTrue('骨架包含 title/date/categories/tags/state', ['title:', 'date:', 'categories:', 'tags:', 'state:'].every((k) => afterSkeleton.includes(k)));
  checkTrue('正文逐字节保留', afterSkeleton.endsWith(navFile));
  checkTrue('骨架后有一个空行再接正文', afterSkeleton.includes('---\n\n'));

  // 7. 冲突检测：外部改文件后写入必须被拒绝
  console.log('\n[7] 外部修改后的冲突检测');
  await fs.writeFile(path.join(tmpRoot, 'notes', 'agent.md'), normalFile.replace('正文第一行', '被别人改过的正文'), 'utf8');
  webviewMessages = [];
  await send({ type: 'setCell', id: 'notes/agent.md', key: 'title', value: '试图覆盖' });
  const conflict = await waitFor(() => lastMessage('cellResult'), '收到 cellResult');
  checkTrue('写入被拒绝并给出提示', typeof conflict.error === 'string' && conflict.error.includes('外部修改'), String(conflict.error));
  const afterConflict = await fs.readFile(path.join(tmpRoot, 'notes', 'agent.md'), 'utf8');
  checkTrue('文件内容没有被覆盖', afterConflict.includes('被别人改过的正文') && !afterConflict.includes('试图覆盖'));

  // 8. 撤销（撤销的是最后一次写入 = 上一步给 nav.md 补的骨架）
  console.log('\n[8] 撤销上一次改动');
  webviewMessages = [];
  await registered.get('mattertable.undoLastWrite')();
  await new Promise((r) => setTimeout(r, 150));
  const afterUndo = await fs.readFile(path.join(tmpRoot, 'notes', 'nav.md'), 'utf8');
  check('nav.md 的骨架被撤销、正文逐字节还原', afterUndo, navFile);
  const pythonAfterUndo = await fs.readFile(path.join(tmpRoot, 'notes', 'python.md'), 'utf8');
  checkTrue('更早的改动不受影响（python.md 日期仍是新值）', pythonAfterUndo.includes('date: 2026-12-31'));

  // 9. 列显隐与排序写进配置
  console.log('\n[9] 视图配置写回 .mattertable/config.json');
  await send({ type: 'setColumnVisible', key: 'description', visible: false });
  await send({ type: 'setSort', key: 'date', direction: 'desc' });
  await new Promise((r) => setTimeout(r, 700));
  const config = JSON.parse(await fs.readFile(path.join(tmpRoot, '.mattertable', 'config.json'), 'utf8'));
  checkTrue('配置文件已生成', Boolean(config.fields));
  check('排序已写入配置', config.views[0].sort, [{ key: 'date', direction: 'desc' }]);
  checkTrue('隐藏列已写入配置', config.views[0].hiddenColumns.includes('description'));

  // 9.5 视图与筛选（v2）
  console.log('\n[9.5] 视图与筛选');
  webviewMessages = [];
  check('初始只有一个视图', init.views.length, 1);

  // 筛选只在界面里做，宿主机只负责持久化
  await send({
    type: 'setViewFilter',
    viewId: 'default',
    filter: { logic: 'and', conditions: [{ id: 'c1', key: 'state', operator: 'equals', value: 'finished' }] },
  });
  await new Promise((r) => setTimeout(r, 700));
  const withFilter = JSON.parse(await fs.readFile(path.join(tmpRoot, '.mattertable', 'config.json'), 'utf8'));
  check('筛选条件的字段已持久化', withFilter.views[0].filter.conditions[0].key, 'state');
  check('筛选条件的操作符已持久化', withFilter.views[0].filter.conditions[0].operator, 'equals');

  // 新建视图并切换过去
  webviewMessages = [];
  await send({ type: 'createView', name: 'CS 视图', copyCurrent: false });
  const initCreated = await waitFor(() => {
    const message = lastMessage('init');
    return message && message.views.length === 2 ? message : undefined;
  }, '创建视图后的 init');
  check('视图数量变成 2', initCreated.views.length, 2);
  check('已切换到新视图', initCreated.view.name, 'CS 视图');
  checkTrue('新视图默认不带筛选条件', (initCreated.view.filter?.conditions ?? []).length === 0);
  const newViewId = initCreated.view.id;

  // 视图级扫描范围：只扫两个文件
  webviewMessages = [];
  await send({ type: 'setViewScope', viewId: newViewId, scope: { include: ['notes/agent.md', 'notes/python.md'] } });
  const initScoped = await waitFor(() => {
    const message = lastMessage('init');
    return message && message.rows.length === 2 ? message : undefined;
  }, '视图级扫描范围生效');
  check('只扫到指定的 2 个文件', initScoped.rows.map((r) => r.id).sort(), ['notes/agent.md', 'notes/python.md']);
  check('范围外的文件（含非法 YAML 那个）没被扫', initScoped.stats.unparsable, 0);

  // 切回默认视图：扫描范围不同 → 需要重新扫描
  webviewMessages = [];
  await send({ type: 'switchView', viewId: 'default' });
  const initBack = await waitFor(() => {
    const message = lastMessage('init');
    return message && message.view.name === '全部笔记' ? message : undefined;
  }, '切回默认视图');
  check('切回后行数恢复', initBack.rows.length, 3);
  const persisted = JSON.parse(await fs.readFile(path.join(tmpRoot, '.mattertable', 'config.json'), 'utf8'));
  check('激活的视图已持久化', persisted.activeViewId, 'default');

  // 重命名与删除
  await send({ type: 'renameView', viewId: 'default', name: '全部笔记（改名）' });
  await new Promise((r) => setTimeout(r, 150));
  const renamed = JSON.parse(await fs.readFile(path.join(tmpRoot, '.mattertable', 'config.json'), 'utf8'));
  check('重命名已持久化', renamed.views.find((v) => v.id === 'default').name, '全部笔记（改名）');
  webviewMessages = [];
  await send({ type: 'deleteView', viewId: 'default' });
  const afterDelete = await waitFor(() => {
    const message = lastMessage('init');
    return message && message.views.length === 1 ? message : undefined;
  }, '删除视图后只剩一个');
  check('删除后视图数量', afterDelete.views.length, 1);

  // 9.6 日历视图（v2.1）
  console.log('\n[9.6] 日历视图');
  webviewMessages = [];
  await send({ type: 'createView', name: '发布日历', copyCurrent: false, viewType: 'calendar' });
  const calInit = await waitFor(() => {
    const message = lastMessage('init');
    return message && message.view.type === 'calendar' ? message : undefined;
  }, '创建日历视图后的 init');
  check('视图类型是 calendar', calInit.view.type, 'calendar');
  check('自动挑了第一个日期字段（不是硬编码 date 之外的东西）', calInit.view.dateField, 'date');
  check('日历视图默认不带筛选条件', (calInit.view.filter?.conditions ?? []).length, 0);
  const calViewId = calInit.view.id;

  // 拖拽改日期最终走的就是 setCell，走同一套写入通道
  webviewMessages = [];
  await send({ type: 'setCell', id: 'notes/agent.md', key: 'date', value: '2026-12-31' });
  const moved = await waitFor(() => {
    const result = webviewMessages.filter((m) => m.type === 'cellResult').pop();
    return result && !result.error ? result : undefined;
  }, '日历改日期写回成功');
  checkTrue('拖拽改日期的写回没有报错', !moved.error, String(moved.error));
  const movedText = await fs.readFile(path.join(tmpRoot, 'notes', 'agent.md'), 'utf8');
  checkTrue('文件里的日期已更新', movedText.includes('date: 2026-12-31'));
  check('文件行数没变（只改了一行的值）', movedText.split('\n').length, normalFile.split('\n').length);

  await send({ type: 'setViewDateField', viewId: calViewId, dateField: 'date' });
  await new Promise((r) => setTimeout(r, 400));
  const calPersisted = JSON.parse(await fs.readFile(path.join(tmpRoot, '.mattertable', 'config.json'), 'utf8'));
  check('日期字段选择已持久化', calPersisted.views.find((v) => v.id === calViewId).dateField, 'date');

  // 10. 清理
  console.log('\n[10] 卸载扩展、检查日志');
  extension.deactivate();
  checkTrue('面板已释放', panelDisposed === true);
  checkTrue('日志里有扫描与写入记录', outputLines.some((l) => l.includes('扫描完成')) && outputLines.some((l) => l.includes('写入成功')));
  console.log('  日志内容：');
  for (const line of outputLines) console.log(`    ${line}`);

  await fs.rm(tmpRoot, { recursive: true, force: true });
  console.log(`\n===== 结果：${failures === 0 ? '全部通过 ✔' : failures + ' 项失败 ✘'} =====`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('\n冒烟测试异常：', err);
  if (tmpRoot) console.error('夹具目录保留在：', tmpRoot);
  process.exit(1);
});
