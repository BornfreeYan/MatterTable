// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InitMessage, ResolvedField, RowData, ViewConfig } from '../src/shared/types';
import { monthLabel, shiftMonth, toDateKey } from '../src/shared/calendar';
import { App } from '../src/webview/App';

/**
 * 界面组件测试。这一组用例是为了盯住两类曾经真出过的 bug：
 *   1. 文本/数字/日期类型的值根本不渲染（单元格显示为空白）
 *   2. 进入编辑时单元格 DOM 被替换，导致下拉面板锚点失效跑到页面左上角
 */

const resizeCallbacks: ResizeObserverCallback[] = [];

class ResizeObserverStub {
  constructor(callback: ResizeObserverCallback) {
    resizeCallbacks.push(callback);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** 触发一次「重新测量」。jsdom 里 clientHeight 恒为 0，正好模拟面板切到后台或元素被卸载的情形。 */
function triggerResize(): void {
  act(() => {
    for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
  });
}

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

const fields: ResolvedField[] = [
  field({ key: '__file', label: '文件名', type: 'text', width: 220, order: -1, source: 'builtin' }),
  field({ key: 'title', label: '标题', type: 'text', width: 260, order: 1 }),
  field({ key: 'date', label: '日期', type: 'date', width: 130, order: 2 }),
  field({ key: 'state', label: '状态', type: 'select', options: ['not started', 'finished'], width: 130, order: 3 }),
  field({ key: 'tags', label: '标签', type: 'multiSelect', options: ['CS', 'AI'], width: 200, order: 4 }),
  field({ key: 'priority', label: 'priority', type: 'number', width: 90, order: 5, source: 'inferred' }),
  field({ key: 'published', label: 'published', type: 'checkbox', width: 90, order: 6, source: 'inferred' }),
  field({ key: 'hero', label: 'hero', type: 'text', width: 120, order: 7, complex: true, visible: false }),
];

const rows: RowData[] = [
  {
    id: 'notes/agent.md',
    fileName: 'agent.md',
    relPath: 'notes/agent.md',
    values: {
      title: 'Agent Concepts Introduction',
      date: '2026-03-07',
      state: ['finished'],
      tags: ['Agent', '工程纪律'],
      priority: 3,
      published: true,
      hero: null,
    },
    hasFrontmatter: true,
  },
  {
    id: 'notes/plain.md',
    fileName: 'plain.md',
    relPath: 'notes/plain.md',
    values: { title: '普通笔记', date: null, state: ['not started'], tags: [], priority: null, published: false, hero: null },
    hasFrontmatter: true,
  },
];

const defaultView: ViewConfig = {
  id: 'default',
  name: '全部笔记',
  type: 'table',
  filter: { logic: 'and', conditions: [] },
  sort: [],
  hiddenColumns: ['hero'],
  columnWidths: {},
};

function initMessage(overrides: Partial<InitMessage> = {}): InitMessage {
  const view = overrides.view ?? defaultView;
  const base: InitMessage = {
    type: 'init',
    fields,
    view,
    views: overrides.views ?? [view],
    rows,
    stats: { shown: 2, unparsable: 0, withoutFrontmatter: 1 },
    chunkSize: 500,
    showFilesWithoutFrontmatter: false,
    scopeRoot: 'D:/demo',
    configPath: 'D:/demo/.mattertable/config.json',
    emptyValueStyle: 'null',
    notices: [],
  };
  const merged = { ...base, ...overrides };
  // 覆盖了 view 时，默认让 views 也带上这个 view，否则界面拿到的当前视图会是旧的
  merged.views = overrides.views ?? [view];
  return merged;
}

/** 模拟宿主发消息（必须在 act 里派发，否则 React 不会刷新） */
function send(data: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }));
  });
}

function renderApp(message: InitMessage = initMessage()) {
  const post = vi.fn();
  const utils = render(<App post={post} />);
  send(message);
  return { post, ...utils };
}

/** 找到某个单元格：按文件名单元格里显示的文本定位行（界面显示的是去掉 .md 的名字），再取第 colIndex 个单元格 */
function cellOf(rowText: string, colIndex: number): HTMLElement {
  const row = screen.getByText(rowText).closest('.row');
  if (!row) throw new Error(`找不到行：${rowText}`);
  const cells = row.querySelectorAll('.td');
  const cell = cells[colIndex];
  if (!cell) throw new Error(`行 ${rowText} 没有第 ${colIndex} 个单元格`);
  return cell as HTMLElement;
}

/** 电子表格习惯：单击只选中，再单击（或双击）才进入编辑 */
function clickTwice(cell: HTMLElement): void {
  fireEvent.click(cell);
  fireEvent.click(cell);
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  resizeCallbacks.length = 0;
});

describe('表格渲染', () => {
  it('文本、日期、数字类型的值都要显示出来（回归：曾经整列空白）', () => {
    renderApp();
    expect(screen.getAllByText('Agent Concepts Introduction').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2026-03-07').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('普通笔记').length).toBeGreaterThan(0);
  });

  it('单选/多选渲染成标签，未定义的值会有标记', () => {
    renderApp();
    expect(screen.getAllByText('finished').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Agent').length).toBeGreaterThan(0);
    expect(screen.getAllByText('工程纪律').length).toBeGreaterThan(0);
  });

  it('每个单元格都按列宽渲染（回归：单元格宽度丢失导致错位）', () => {
    renderApp();
    const titleCell = cellOf('agent', 1);
    expect(titleCell.style.width).toBe('260px');
    const dateCell = cellOf('agent', 2);
    expect(dateCell.style.width).toBe('130px');
    const header = document.querySelectorAll('.th')[1] as HTMLElement;
    expect(header.style.width).toBe('260px');
  });

  it('嵌套结构字段默认不显示；只有配置里显式声明 visible 才作为只读列出现', () => {
    renderApp();
    expect(screen.queryByText('（嵌套结构，只读）')).toBeNull();

    // 即使视图的隐藏列表里没有它，也不该出现（回归：嵌套列被当成普通列显示出来）
    cleanup();
    const emptyHidden: ViewConfig = { id: 'default', name: '全部', type: 'table', sort: [], hiddenColumns: [], columnWidths: {} };
    renderApp(initMessage({ view: emptyHidden }));
    expect(screen.queryByText('（嵌套结构，只读）')).toBeNull();

    // 配置里显式声明 visible: true 才显示为只读列
    cleanup();
    const declared = fields.map((f) => (f.key === 'hero' ? { ...f, visible: true } : f));
    renderApp(initMessage({ fields: declared }));
    expect(screen.getAllByText('（嵌套结构，只读）').length).toBeGreaterThan(0);
  });

  it('拖动列头可以调整列顺序，并把顺序写进配置', () => {
    const { post } = renderApp();
    const labels = () =>
      [...document.querySelectorAll('.th')].map((th) => th.textContent?.replace(/[▲▼]/g, '') ?? '');
    expect(labels().slice(0, 4)).toEqual(['文件名', '标题', '日期', '状态']);

    const headers = document.querySelectorAll('.th');
    fireEvent.dragStart(headers[3]);
    fireEvent.dragOver(headers[1]);
    fireEvent.drop(headers[1]);

    expect(labels().slice(0, 4)).toEqual(['文件名', '状态', '标题', '日期']);
    expect(post).toHaveBeenCalledWith({ type: 'setColumnOrder', order: expect.any(Array) });
  });

  it('文件名列不参与拖动排序', () => {
    renderApp();
    const headers = document.querySelectorAll('.th');
    expect(headers[0].getAttribute('draggable')).toBe('false');
    expect(headers[1].getAttribute('draggable')).toBe('true');
  });

  it('无法解析的文件标红并给出 ⚠', () => {
    const broken: RowData = {
      id: 'notes/broken.md',
      fileName: 'broken.md',
      relPath: 'notes/broken.md',
      values: { title: null },
      hasFrontmatter: true,
      parseError: '冒号未转义',
    };
    renderApp(initMessage({ rows: [...rows, broken], stats: { shown: 3, unparsable: 1, withoutFrontmatter: 0 } }));
    expect(screen.getAllByText('⚠').length).toBe(1);
    expect(document.querySelector('.row-error')).toBeTruthy();
  });

  it('没有 front matter 的行显示「补骨架」按钮', () => {
    const nav: RowData = {
      id: 'notes/nav.md',
      fileName: 'nav.md',
      relPath: 'notes/nav.md',
      values: {},
      hasFrontmatter: false,
    };
    const { post } = renderApp(initMessage({ rows: [...rows, nav] }));
    const button = screen.getByText('补骨架');
    fireEvent.click(button);
    expect(post).toHaveBeenCalledWith({ type: 'addSkeleton', id: 'notes/nav.md' });
  });
});

describe('编辑交互', () => {
  it('单击只选中，再单击才进入编辑；选中后按 Delete 清空（回归：没法选中单元格）', async () => {
    const { post } = renderApp();
    fireEvent.click(cellOf('agent', 1));
    expect(screen.queryByDisplayValue('Agent Concepts Introduction')).toBeNull();
    expect(cellOf('agent', 1).className).toContain('cell-selected');

    fireEvent.click(cellOf('agent', 1));
    const input = await screen.findByDisplayValue('Agent Concepts Introduction');
    fireEvent.keyDown(input, { key: 'Escape' });

    fireEvent.keyDown(document.querySelector('.grid') as HTMLElement, { key: 'Delete' });
    expect(post).toHaveBeenCalledWith({ type: 'clearCell', id: 'notes/agent.md', key: 'title' });
  });

  it('进入编辑后输入框可改值，回车提交写盘', async () => {
    const { post } = renderApp();
    clickTwice(cellOf('agent', 1));
    const input = await screen.findByDisplayValue('Agent Concepts Introduction');
    fireEvent.change(input, { target: { value: '新标题' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(post).toHaveBeenCalledWith({ type: 'setCell', id: 'notes/agent.md', key: 'title', value: '新标题' });
  });

  it('数字列输入非数字会被拒绝并给出提示', async () => {
    const { post } = renderApp();
    clickTwice(cellOf('agent', 5));
    const input = await screen.findByDisplayValue('3');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/不是合法数字/)).toBeTruthy());
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setCell' }));
  });

  it('点击复选框直接切换并写盘', () => {
    const { post } = renderApp();
    const cell = cellOf('agent', 6);
    fireEvent.click(cell);
    expect(post).toHaveBeenCalledWith({ type: 'setCell', id: 'notes/agent.md', key: 'published', value: false });
  });

  it('单选下拉出现在单元格附近，而不是页面左上角（回归：锚点失效）', async () => {
    renderApp();
    const cell = cellOf('agent', 3);
    cell.getBoundingClientRect = () => ({ x: 400, y: 200, left: 400, top: 200, right: 530, bottom: 230, width: 130, height: 30, toJSON: () => ({}) });
    clickTwice(cell);
    const popup = await screen.findByTestId('select-popup');
    expect(popup.style.visibility).toBe('visible');
    expect(popup.style.left).toBe('400px');
    expect(popup.style.top).toBe('232px');
  });

  it('单选可以选择已有选项', async () => {
    const { post } = renderApp();
    clickTwice(cellOf('agent', 3));
    const popup = await screen.findByTestId('select-popup');
    fireEvent.mouseDown(within(popup).getByText('not started'));
    expect(post).toHaveBeenCalledWith({ type: 'setCell', id: 'notes/agent.md', key: 'state', value: 'not started' });
  });

  it('多选：输入新标签并回车能立刻写盘（回归：新标签输入后丢失）', async () => {
    const { post } = renderApp();
    clickTwice(cellOf('agent', 4));
    const popup = await screen.findByTestId('multiselect-popup');
    const input = within(popup).getByPlaceholderText('输入后回车添加标签…');
    fireEvent.change(input, { target: { value: '新标签' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(post).toHaveBeenCalledWith({
      type: 'setCell',
      id: 'notes/agent.md',
      key: 'tags',
      value: ['Agent', '工程纪律', '新标签'],
    });
    // 新增选项的请求也会发出去（标签不在选项池里）
    expect(post).toHaveBeenCalledWith({ type: 'addOption', key: 'tags', value: '新标签' });
  });

  it('多选：点建议项添加已有标签，并按回车结束编辑', async () => {
    const { post } = renderApp();
    clickTwice(cellOf('agent', 4));
    const popup = await screen.findByTestId('multiselect-popup');
    fireEvent.mouseDown(within(popup).getByText('CS'));
    expect(post).toHaveBeenCalledWith({
      type: 'setCell',
      id: 'notes/agent.md',
      key: 'tags',
      value: ['Agent', '工程纪律', 'CS'],
    });
    const input = within(popup).getByPlaceholderText('输入后回车添加标签…');
    fireEvent.keyDown(input, { key: 'Enter' });
    // 结束后弹窗关闭
    await waitFor(() => expect(screen.queryByTestId('multiselect-popup')).toBeNull());
  });

  it('多选：逐个移除标签', async () => {
    const { post } = renderApp();
    clickTwice(cellOf('agent', 4));
    const popup = await screen.findByTestId('multiselect-popup');
    const removeButtons = within(popup).getAllByTitle('移除');
    fireEvent.mouseDown(removeButtons[0]);
    expect(post).toHaveBeenCalledWith({ type: 'setCell', id: 'notes/agent.md', key: 'tags', value: ['工程纪律'] });
  });

  it('无法解析的行点不动（单元格不可编辑）', async () => {
    const broken: RowData = {
      id: 'notes/broken.md',
      fileName: 'broken.md',
      relPath: 'notes/broken.md',
      values: { title: '发现问题' },
      hasFrontmatter: true,
      parseError: '冒号未转义',
    };
    renderApp(initMessage({ rows: [broken] }));
    const cell = cellOf('broken', 1);
    expect(cell.className).toContain('ro');
    fireEvent.click(cell);
    expect(screen.queryByDisplayValue('发现问题')).toBeNull();
  });
});

describe('宿主消息', () => {
  it('fieldsUpdated 只更新字段，不清空行数据（回归：新增选项导致整表重载）', () => {
    renderApp();
    const updated = fields.map((f) => (f.key === 'tags' ? { ...f, options: ['CS', 'AI', '新标签'], optionsAuto: false } : f));
    send({ type: 'fieldsUpdated', fields: updated });
    expect(screen.getAllByText('Agent Concepts Introduction').length).toBeGreaterThan(0);
    expect(screen.getAllByText('普通笔记').length).toBeGreaterThan(0);
  });

  it('rowsUpdated 能增量替换某一行的值', () => {
    renderApp();
    const changed: RowData = { ...rows[0], values: { ...rows[0].values, title: '改过的标题' } };
    send({ type: 'rowsUpdated', rows: [changed] });
    expect(screen.getAllByText('改过的标题').length).toBeGreaterThan(0);
    expect(screen.queryByText('Agent Concepts Introduction')).toBeNull();
  });

  it('写入失败时回退单元格的值并给出错误提示', async () => {
    renderApp();
    send({ type: 'cellResult', id: 'notes/agent.md', key: 'title', value: '被拒绝的值', error: '文件已被外部修改' });
    await waitFor(() => expect(screen.getByText('文件已被外部修改')).toBeTruthy());
    expect(screen.getAllByText('被拒绝的值').length).toBeGreaterThan(0);
  });

  it('viewUpdated 会套用新的列宽与隐藏列表', () => {
    renderApp();
    const view: ViewConfig = {
      id: 'default',
      name: '全部',
      type: 'table',
      hiddenColumns: ['hero', 'priority'],
      columnWidths: { title: 300 },
    };
    send({ type: 'viewUpdated', view });
    expect(cellOf('agent', 1).style.width).toBe('300px');
    expect(screen.queryByText('priority')).toBeNull();
  });
});

describe('视图与筛选（v2）', () => {
  const stateCondition = (value: string): ViewConfig => ({
    ...defaultView,
    filter: { logic: 'and', conditions: [{ id: 'c1', key: 'state', operator: 'equals', value }] },
  });

  it('筛选条件生效：只显示匹配的行，并在统计里显示 X / 共 Y 行', () => {
    renderApp(initMessage({ view: stateCondition('finished') }));
    expect(screen.getByText('agent')).toBeTruthy();
    expect(screen.queryByText('plain')).toBeNull();
    expect(document.querySelector('.stats')?.textContent).toContain('显示 1 / 共 2 行');
  });

  it('OR 逻辑：任一条件满足就显示', () => {
    const view: ViewConfig = {
      ...defaultView,
      filter: {
        logic: 'or',
        conditions: [
          { id: 'c1', key: 'state', operator: 'equals', value: 'finished' },
          { id: 'c2', key: 'state', operator: 'equals', value: 'not started' },
        ],
      },
    };
    renderApp(initMessage({ view }));
    expect(screen.getByText('agent')).toBeTruthy();
    expect(screen.getByText('plain')).toBeTruthy();
  });

  it('切换操作符会发出 setViewFilter（带新操作符与重置后的值）', () => {
    const { post } = renderApp(initMessage({ view: stateCondition('finished') }));
    const operatorSelect = document.querySelector('.filterbar .cond select') as HTMLSelectElement;
    expect(operatorSelect.value).toBe('equals');
    fireEvent.change(operatorSelect, { target: { value: 'isEmpty' } });
    expect(post).toHaveBeenCalledWith({
      type: 'setViewFilter',
      viewId: 'default',
      filter: { logic: 'and', conditions: [{ id: 'c1', key: 'state', operator: 'isEmpty', value: null }] },
    });
  });

  it('修改条件的值会发出 setViewFilter', () => {
    const { post } = renderApp(initMessage({ view: stateCondition('finished') }));
    const selects = document.querySelectorAll('.filterbar .cond select');
    const valueSelect = selects[1] as HTMLSelectElement;
    fireEvent.change(valueSelect, { target: { value: 'not started' } });
    expect(post).toHaveBeenCalledWith({
      type: 'setViewFilter',
      viewId: 'default',
      filter: { logic: 'and', conditions: [{ id: 'c1', key: 'state', operator: 'equals', value: 'not started' }] },
    });
  });

  it('添加条件：先选字段，再发出 setViewFilter', () => {
    const { post } = renderApp();
    fireEvent.click(screen.getByText('＋ 添加条件'));
    const picker = document.querySelector('.filterbar .panel') as HTMLElement;
    fireEvent.click(within(picker).getByText('标题'));
    const call = post.mock.calls.find(([m]) => m.type === 'setViewFilter');
    expect(call).toBeTruthy();
    const filter = (call?.[0] as { filter: { conditions: { key: string; operator: string }[] } }).filter;
    expect(filter.conditions).toHaveLength(1);
    expect(filter.conditions[0].key).toBe('title');
    expect(filter.conditions[0].operator).toBe('equals');
  });

  it('移除条件会立刻生效，并发出 setViewFilter', () => {
    const { post } = renderApp(initMessage({ view: stateCondition('finished') }));
    expect(document.querySelectorAll('.filterbar .cond')).toHaveLength(1);
    expect(screen.queryByText('plain')).toBeNull();

    fireEvent.click(document.querySelector('.filterbar .cond-remove') as HTMLElement);

    expect(post).toHaveBeenCalledWith({
      type: 'setViewFilter',
      viewId: 'default',
      filter: { logic: 'and', conditions: [] },
    });
    // 立刻生效：条件药丸消失、两行都回来了（回归：必须刷新才生效）
    expect(document.querySelectorAll('.filterbar .cond')).toHaveLength(0);
    expect(screen.getByText('agent')).toBeTruthy();
    expect(screen.getByText('plain')).toBeTruthy();
  });

  it('点击「清除」会立刻恢复所有行（回归：必须刷新才清除）', () => {
    const view: ViewConfig = {
      ...defaultView,
      filter: {
        logic: 'and',
        conditions: [
          { id: 'c1', key: 'state', operator: 'equals', value: 'finished' },
          { id: 'c2', key: 'title', operator: 'contains', value: 'Agent' },
        ],
      },
    };
    const { post } = renderApp(initMessage({ view }));
    expect(screen.queryByText('plain')).toBeNull();

    fireEvent.click(screen.getByText('清除'));
    expect(post).toHaveBeenCalledWith({
      type: 'setViewFilter',
      viewId: 'default',
      filter: { logic: 'and', conditions: [] },
    });
    expect(screen.getByText('plain')).toBeTruthy();
    expect(screen.getByText('agent')).toBeTruthy();
  });

  it('添加条件后立刻生效：条件药丸与操作符下拉立即出现，行数立即变化（回归：无响应需刷新）', () => {
    renderApp();
    expect(screen.getByText('agent')).toBeTruthy();
    expect(screen.getByText('plain')).toBeTruthy();

    fireEvent.click(screen.getByText('＋ 添加条件'));
    const picker = document.querySelector('.filterbar .panel') as HTMLElement;
    fireEvent.click(within(picker).getByText('状态'));

    // 条件药丸、操作符下拉、值下拉都立刻出现
    const cond = document.querySelector('.filterbar .cond') as HTMLElement;
    expect(cond).toBeTruthy();
    const selects = within(cond).getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects.length).toBeGreaterThanOrEqual(2);
    expect(selects[0].value).toBe('equals');
    // 默认值取选项池第一项（not started），所以立刻只剩 plain 那一行
    expect(selects[1].value).toBe('not started');
    expect(screen.getByText('plain')).toBeTruthy();
    expect(screen.queryByText('agent')).toBeNull();
  });

  it('把操作符改成「为空」立刻生效并重算行数', () => {
    renderApp(initMessage({ view: stateCondition('finished') }));
    const operatorSelect = document.querySelector('.filterbar .cond select') as HTMLSelectElement;
    fireEvent.change(operatorSelect, { target: { value: 'isEmpty' } });
    // 两行的 state 都不为空 → 立刻变成 0 行
    expect(document.querySelector('.stats')?.textContent).toContain('显示 0 / 共 2 行');
  });

  it('切换 AND / OR 立刻生效', () => {
    const view: ViewConfig = {
      ...defaultView,
      filter: {
        logic: 'and',
        conditions: [
          { id: 'c1', key: 'title', operator: 'contains', value: 'Agent' },
          { id: 'c2', key: 'state', operator: 'equals', value: 'not started' },
        ],
      },
    };
    renderApp(initMessage({ view }));
    // AND：Agent 那行是 finished，plain 那行标题不含 Agent → 0 行
    expect(document.querySelector('.stats')?.textContent).toContain('显示 0 / 共 2 行');

    const logicSelect = [...document.querySelectorAll('.filterbar select')].pop() as HTMLSelectElement;
    fireEvent.change(logicSelect, { target: { value: 'or' } });
    expect(screen.getByText('agent')).toBeTruthy();
    expect(screen.getByText('plain')).toBeTruthy();
  });

  it('条件引用的字段不存在时不筛掉行，并标出该条件失效', () => {
    const view: ViewConfig = {
      ...defaultView,
      filter: { logic: 'and', conditions: [{ id: 'c1', key: 'removedKey', operator: 'equals', value: 'x' }] },
    };
    renderApp(initMessage({ view }));
    expect(screen.getByText('agent')).toBeTruthy();
    expect(screen.getByText('plain')).toBeTruthy();
    expect(screen.getByText(/字段已不存在/)).toBeTruthy();
  });

  it('视图切换器列出所有视图，点另一个会发出 switchView', () => {
    const { post } = renderApp();
    const csView: ViewConfig = { id: 'cs', name: 'CS 视图', type: 'table', filter: { logic: 'and', conditions: [] } };
    send(initMessage({ views: [defaultView, csView] }));
    fireEvent.click(screen.getByText(/视图：全部笔记/));
    fireEvent.click(screen.getByText('CS 视图'));
    expect(post).toHaveBeenCalledWith({ type: 'switchView', viewId: 'cs' });
  });

  it('视图菜单里的新建 / 复制 / 重命名 / 删除都会发出对应消息', () => {
    const csView: ViewConfig = { id: 'cs', name: 'CS 视图', type: 'table', filter: { logic: 'and', conditions: [] } };
    const { post } = renderApp(initMessage({ views: [defaultView, csView] }));
    const open = () => fireEvent.click(screen.getByText(/视图：全部笔记/));

    open();
    fireEvent.click(screen.getByText('⧉ 复制当前视图（含筛选条件与列设置）'));
    expect(post).toHaveBeenCalledWith({ type: 'duplicateView', viewId: 'default' });

    open();
    fireEvent.click(screen.getByText('✎ 重命名当前视图'));
    const input = screen.getByPlaceholderText('视图名称');
    fireEvent.change(input, { target: { value: '我的视图' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(post).toHaveBeenCalledWith({ type: 'renameView', viewId: 'default', name: '我的视图' });

    open();
    fireEvent.click(screen.getByText('✕ 删除当前视图'));
    expect(post).toHaveBeenCalledWith({ type: 'deleteView', viewId: 'default' });
  });

  it('只剩一个视图时不允许删除（点删除不发消息）', () => {
    const { post } = renderApp();
    fireEvent.click(screen.getByText(/视图：全部笔记/));
    fireEvent.click(screen.getByText('✕ 删除当前视图'));
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'deleteView' }));
  });

  it('新建表格视图需要填名字，回车后发出 createView', () => {
    const { post } = renderApp();
    fireEvent.click(screen.getByText(/视图：全部笔记/));
    fireEvent.click(screen.getByText('＋ 新建表格视图（不含筛选条件）'));
    const input = screen.getByPlaceholderText('例如：CS 笔记');
    fireEvent.change(input, { target: { value: 'CS 笔记' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(post).toHaveBeenCalledWith({ type: 'createView', name: 'CS 笔记', copyCurrent: false, viewType: 'table' });
  });

  it('视图设置面板可以保存扫描范围', () => {
    const { post } = renderApp();
    fireEvent.click(screen.getByText(/视图：全部笔记/));
    fireEvent.click(screen.getByText('⌂ 当前视图的扫描范围…'));
    const form = document.querySelector('[data-testid="scope-form"]') as HTMLElement;
    fireEvent.change(form.querySelector('input') as HTMLInputElement, {
      target: { value: 'D:\\KB\\3 Agent Dev' },
    });
    fireEvent.change(form.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: '**/Raw/**\n**/tmp/**' },
    });
    fireEvent.click(screen.getByText('保存并重新扫描'));
    expect(post).toHaveBeenCalledWith({
      type: 'setViewScope',
      viewId: 'default',
      scope: { root: 'D:\\KB\\3 Agent Dev', exclude: ['**/Raw/**', '**/tmp/**'] },
    });
  });

  it('viewsUpdated 只更新切换器，不清空行数据', () => {
    renderApp();
    const csView: ViewConfig = { id: 'cs', name: 'CS 视图', type: 'table', filter: { logic: 'and', conditions: [] } };
    send({ type: 'viewsUpdated', views: [defaultView, csView], currentId: 'cs' });
    expect(screen.getByText(/视图：CS 视图/)).toBeTruthy();
    expect(screen.getByText('agent')).toBeTruthy();
    expect(screen.getByText('plain')).toBeTruthy();
  });
});

describe('日历视图（v2.1）', () => {
  const today = new Date();
  const day1 = toDateKey(new Date(today.getFullYear(), today.getMonth(), 1));
  const day2 = toDateKey(new Date(today.getFullYear(), today.getMonth(), 2));

  const calFields: ResolvedField[] = [
    field({ key: '__file', label: '文件名', type: 'text', width: 220, order: -1, source: 'builtin' }),
    field({ key: 'title', label: '标题', type: 'text', width: 260, order: 1 }),
    field({ key: 'date', label: '日期', type: 'date', width: 130, order: 2 }),
    field({ key: 'updated', label: '更新日期', type: 'date', width: 130, order: 3, source: 'inferred' }),
    field({ key: 'state', label: '状态', type: 'select', options: ['not started', 'finished'], width: 130, order: 4 }),
  ];

  const calRows: RowData[] = [
    {
      id: 'a.md',
      fileName: 'a.md',
      relPath: 'd/a.md',
      values: { title: '第一篇', date: day1, updated: day2, state: ['finished'] },
      hasFrontmatter: true,
    },
    {
      id: 'b.md',
      fileName: 'b.md',
      relPath: 'd/b.md',
      values: { title: '第二篇', date: day2, updated: day1, state: ['not started'] },
      hasFrontmatter: true,
    },
    {
      id: 'c.md',
      fileName: 'c.md',
      relPath: 'd/c.md',
      values: { title: '没有日期', date: null, updated: null, state: ['not started'] },
      hasFrontmatter: true,
    },
  ];

  const calView: ViewConfig = {
    id: 'cal',
    name: '发布日历',
    type: 'calendar',
    dateField: 'date',
    filter: { logic: 'and', conditions: [] },
  };

  const calInit = (over: Partial<InitMessage> = {}): InitMessage =>
    initMessage({ fields: calFields, rows: calRows, view: calView, views: [calView], ...over });

  const dayCell = (key: string): HTMLElement => document.querySelector(`[data-day="${key}"]`) as HTMLElement;
  const itemsIn = (key: string): string[] =>
    [...(dayCell(key)?.querySelectorAll('.cal-item') ?? [])].map((el) => el.textContent ?? '');
  const statsText = (): string => document.querySelector('.cal-toolbar .stats')?.textContent ?? '';

  it('把有日期的笔记铺到月历上，没有日期的只计数不显示', () => {
    renderApp(calInit());
    expect(itemsIn(day1)).toEqual(['第一篇']);
    expect(itemsIn(day2)).toEqual(['第二篇']);
    expect(document.querySelectorAll('.cal-item')).toHaveLength(2);
    expect(statsText()).toContain('本月 2 项');
    expect(statsText()).toContain('另有 1 项没有日期');
  });

  it('不硬编码 date：换一个日期字段后按新字段归类', () => {
    const view: ViewConfig = { ...calView, dateField: 'updated' };
    renderApp(calInit({ view, views: [view] }));
    expect(itemsIn(day1)).toEqual(['第二篇']);
    expect(itemsIn(day2)).toEqual(['第一篇']);
    expect(document.querySelectorAll('.cal-item')).toHaveLength(2);
  });

  it('点卡片在新标签页打开文件', () => {
    const { post } = renderApp(calInit());
    fireEvent.click(document.querySelector(`[data-day="${day1}"] .cal-item`) as HTMLElement);
    expect(post).toHaveBeenCalledWith({ type: 'openFile', id: 'a.md' });
  });

  it('把卡片拖到另一天：界面立刻移动，并写回新的日期（回归：不能只发消息不更新界面）', () => {
    const { post } = renderApp(calInit());
    const item = document.querySelector(`[data-day="${day1}"] .cal-item`) as HTMLElement;
    const target = dayCell(day2);

    fireEvent.dragStart(item);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    expect(post).toHaveBeenCalledWith({ type: 'setCell', id: 'a.md', key: 'date', value: day2 });
    expect(itemsIn(day1)).toEqual([]);
    expect(new Set(itemsIn(day2))).toEqual(new Set(['第一篇', '第二篇']));
  });

  it('拖动时高亮目标日期格，松手后取消高亮', () => {
    renderApp(calInit());
    const item = document.querySelector(`[data-day="${day1}"] .cal-item`) as HTMLElement;
    fireEvent.dragStart(item);
    fireEvent.dragOver(dayCell(day2));
    expect(dayCell(day2).className).toContain('drop');
    fireEvent.drop(dayCell(day2));
    expect(dayCell(day2).className).not.toContain('drop');
  });

  it('月份导航：前翻、后翻、回到今天', () => {
    renderApp(calInit());
    const current = monthLabel(today.getFullYear(), today.getMonth());
    expect(screen.getByText(current)).toBeTruthy();

    fireEvent.click(screen.getByTitle('上个月'));
    const prev = shiftMonth(today.getFullYear(), today.getMonth(), -1);
    expect(screen.getByText(monthLabel(prev.year, prev.month))).toBeTruthy();

    fireEvent.click(screen.getByTitle('下个月'));
    expect(screen.getByText(current)).toBeTruthy();

    fireEvent.click(screen.getByTitle('上个月'));
    fireEvent.click(screen.getByTitle('回到本月'));
    expect(screen.getByText(current)).toBeTruthy();
  });

  it('切换日期字段会把选择发给宿主机', () => {
    const { post } = renderApp(calInit());
    const select = document.querySelector('.cal-field select') as HTMLSelectElement;
    expect(select.value).toBe('date');
    expect([...select.options].map((o) => o.textContent)).toEqual(['日期', '更新日期']);
    fireEvent.change(select, { target: { value: 'updated' } });
    expect(post).toHaveBeenCalledWith({ type: 'setViewDateField', viewId: 'cal', dateField: 'updated' });
  });

  it('配置的日期字段已不存在时自动回退到第一个日期字段', () => {
    const view: ViewConfig = { ...calView, dateField: '已经删掉的字段' };
    renderApp(calInit({ view, views: [view] }));
    expect(itemsIn(day1)).toEqual(['第一篇']);
    expect((document.querySelector('.cal-field select') as HTMLSelectElement).value).toBe('date');
  });

  it('没有 date 类型字段时显示空状态并说明怎么修', () => {
    const noDateFields = calFields.map((f) => (f.type === 'date' ? { ...f, type: 'text' as const } : f));
    renderApp(calInit({ fields: noDateFields }));
    expect(document.querySelector('.cal-grid')).toBeNull();
    expect(screen.getByText(/还没有可用的日期字段/)).toBeTruthy();
  });

  it('筛选在日历视图里同样生效', () => {
    const view: ViewConfig = {
      ...calView,
      filter: { logic: 'and', conditions: [{ id: 'c1', key: 'state', operator: 'equals', value: 'finished' }] },
    };
    renderApp(calInit({ view, views: [view] }));
    expect(itemsIn(day1)).toEqual(['第一篇']);
    expect(itemsIn(day2)).toEqual([]);
    expect(statsText()).toContain('本月 1 项');
  });

  it('筛选结果全都没有日期时给出提示而不是空白', () => {
    const view: ViewConfig = {
      ...calView,
      filter: { logic: 'and', conditions: [{ id: 'c1', key: 'title', operator: 'contains', value: '没有日期' }] },
    };
    renderApp(calInit({ view, views: [view] }));
    expect(document.querySelectorAll('.cal-item')).toHaveLength(0);
    expect(screen.getByText(/没有任何笔记填写了/)).toBeTruthy();
  });

  it('日历视图下隐藏表格专属的工具栏项，但保留视图切换与配置', () => {
    renderApp(calInit());
    const toolbar = document.querySelector('.toolbar')?.textContent ?? '';
    expect(toolbar).not.toContain('字段（');
    expect(toolbar).not.toContain('显示无 front matter');
    expect(toolbar).toContain('视图：发布日历');
    expect(toolbar).toContain('配置');
    expect(document.querySelector('.grid')).toBeNull();
  });

  it('视图菜单里能新建日历视图', () => {
    const { post } = renderApp(calInit());
    fireEvent.click(screen.getByText(/视图：发布日历/));
    fireEvent.click(screen.getByText('＋ 新建日历视图（按日期字段铺到月历上）'));
    const input = screen.getByPlaceholderText('例如：发布日历');
    fireEvent.change(input, { target: { value: '发布计划' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(post).toHaveBeenCalledWith({ type: 'createView', name: '发布计划', copyCurrent: false, viewType: 'calendar' });
  });
});

describe('虚拟滚动的视口高度（回归：表格只渲染最上面几行）', () => {
  const manyRows: RowData[] = Array.from({ length: 80 }, (_, i) => ({
    id: `n${i}.md`,
    fileName: `n${i}.md`,
    relPath: `d/n${i}.md`,
    values: { title: `第 ${i} 篇`, date: null, state: [], tags: [], priority: null, published: null, hero: null },
    hasFrontmatter: true,
  }));
  const manyInit = (over: Partial<InitMessage> = {}): InitMessage =>
    initMessage({ rows: manyRows, stats: { shown: manyRows.length, unparsable: 0, withoutFrontmatter: 0 }, ...over });

  it('测量到 0 高度时按兜底视口渲染，而不是退化成只剩 overscan 那几行', () => {
    renderApp(manyInit());
    const before = document.querySelectorAll('.row').length;
    expect(before).toBeGreaterThan(20);

    triggerResize(); // 模拟一次 0 高度测量（面板切到后台 / 元素正在卸载）
    expect(document.querySelectorAll('.row').length).toBe(before);
  });

  it('从日历视图切到表格视图后表格仍然铺满，并且滚动能继续渲染后面的行', () => {
    const calendarView: ViewConfig = {
      id: 'cal2',
      name: '日历',
      type: 'calendar',
      dateField: 'date',
      filter: { logic: 'and', conditions: [] },
    };
    renderApp(manyInit({ view: calendarView, views: [calendarView] }));
    expect(document.querySelector('.calendar')).toBeTruthy();
    triggerResize(); // 日历挂载时表格并不存在，这次测量会被忽略

    send(manyInit({ view: defaultView, views: [defaultView] }));
    expect(document.querySelector('.calendar')).toBeNull();
    expect(document.querySelectorAll('.row').length).toBeGreaterThan(20);

    triggerResize();
    expect(document.querySelectorAll('.row').length).toBeGreaterThan(20);

    // 虚拟滚动本身没坏：滚下去能渲染出后面的行
    const grid = document.querySelector('.grid') as HTMLElement;
    grid.scrollTop = 1200;
    fireEvent.scroll(grid);
    expect(screen.getByText('第 48 篇')).toBeTruthy();
  });
});

describe('消息提示（toast）', () => {
  it('提示以右下角浮层展示，不会挤占表格布局', () => {
    renderApp();
    expect(document.querySelector('.app > .toasts')).toBeNull();
    send({ type: 'notice', notice: { level: 'info', message: '已创建视图「CS」' } });
    const toasts = document.querySelector('.app > .toasts');
    expect(toasts).toBeTruthy();
    expect(toasts?.textContent).toContain('已创建视图');
    // 表格容器仍然是 app 的直接子元素，说明提示是浮层而不是占位元素
    expect(document.querySelector('.app > .grid')).toBeTruthy();
  });

  it('提示类消息会自动消失，错误消息留着等手动关闭', () => {
    vi.useFakeTimers();
    try {
      renderApp();
      send({ type: 'notice', notice: { level: 'info', message: '已复制视图' } });
      expect(document.querySelector('.toast.info')).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(4500);
      });
      expect(document.querySelector('.toast.info')).toBeNull();

      send({ type: 'notice', notice: { level: 'error', message: '写入失败：文件已被外部修改' } });
      act(() => {
        vi.advanceTimersByTime(30000);
      });
      expect(document.querySelector('.toast.error')).toBeTruthy();
      fireEvent.click(document.querySelector('.toast.error button') as HTMLElement);
      expect(document.querySelector('.toast.error')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('相同内容的消息不会重复弹出', () => {
    renderApp();
    send({ type: 'notice', notice: { level: 'info', message: '重复消息' } });
    send({ type: 'notice', notice: { level: 'info', message: '重复消息' } });
    send({ type: 'notice', notice: { level: 'info', message: '另一条' } });
    expect(document.querySelectorAll('.toast')).toHaveLength(2);
  });
});
