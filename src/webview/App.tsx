import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyFilter } from '../shared/filter';
import { FILE_COLUMN_KEY, sortRows } from '../shared/sort';
import type {
  CellValue,
  FieldType,
  HostToWebview,
  Notice,
  ResolvedField,
  RowData,
  SortDirection,
  TableStats,
  ViewConfig,
  ViewFilter,
  WebviewToHost,
} from '../shared/types';
import { cellToText } from '../shared/values';
import { Cell } from './cells';
import type { EditorCallbacks } from './cells';
import { CalendarView } from './CalendarView';
import { FilterBar, ViewSwitcher } from './views';

const ROW_H = 30;
const HEADER_H = 30;
const OVERSCAN = 8;
/** 视口高度测量失败时的兜底值 */
const FALLBACK_VIEWPORT_H = 600;

const EMPTY_VIEW: ViewConfig = {
  id: '',
  name: '…',
  type: 'table',
  filter: { logic: 'and', conditions: [] },
  sort: [],
  hiddenColumns: [],
  columnOrder: [],
  columnWidths: {},
};

interface NoticeEntry extends Notice {
  id: number;
}

function typeLabel(type: FieldType): string {
  switch (type) {
    case 'text':
      return '文本';
    case 'number':
      return '数字';
    case 'checkbox':
      return '复选框';
    case 'date':
      return '日期';
    case 'select':
      return '单选';
    case 'multiSelect':
      return '多选';
    default:
      return type;
  }
}

export interface AppProps {
  post: (message: WebviewToHost) => void;
}

export function App({ post }: AppProps): JSX.Element {
  const [fields, setFields] = useState<ResolvedField[]>([]);
  const [rows, setRows] = useState<RowData[]>([]);
  const [views, setViews] = useState<ViewConfig[]>([]);
  const [viewId, setViewId] = useState('');
  const [stats, setStats] = useState<TableStats>({ shown: 0, unparsable: 0, withoutFrontmatter: 0 });
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [showWithout, setShowWithout] = useState(false);
  const [scopeRoot, setScopeRoot] = useState('');
  const [configPath, setConfigPath] = useState('');
  const [notices, setNotices] = useState<NoticeEntry[]>([]);
  const [sel, setSel] = useState<{ row: number; col: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const currentView = useMemo(() => views.find((v) => v.id === viewId) ?? views[0] ?? EMPTY_VIEW, [views, viewId]);
  const isCalendar = currentView.type === 'calendar';

  const gridRef = useRef<HTMLDivElement>(null);
  const noticeId = useRef(1);

  const pushNotice = useCallback((level: Notice['level'], message: string) => {
    const id = noticeId.current++;
    setNotices((prev) => {
      // 相同内容已经在显示 → 不重复弹
      if (prev.some((n) => n.message === message)) return prev;
      return [...prev.slice(-3), { id, level, message }];
    });
    if (level !== 'error') {
      // 提示类消息自动消失；错误留着等用户看完手动关
      window.setTimeout(() => setNotices((prev) => prev.filter((n) => n.id !== id)), level === 'warn' ? 8000 : 4000);
    }
  }, []);

  const setLocalCell = useCallback((id: string, key: string, value: CellValue) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, values: { ...row.values, [key]: value } } : row)));
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as HostToWebview;
      switch (msg.type) {
        case 'init':
          setFields(msg.fields);
          setRows(msg.rows);
          setViews(msg.views ?? []);
          setViewId(msg.view.id);
          setStats(msg.stats);
          setSort(msg.view.sort && msg.view.sort.length > 0 ? msg.view.sort[0] : null);
          setHidden(msg.view.hiddenColumns ?? []);
          setWidths(msg.view.columnWidths ?? {});
          setOrder(msg.view.columnOrder ?? msg.fields.map((f) => f.key));
          setShowWithout(msg.showFilesWithoutFrontmatter);
          setScopeRoot(msg.scopeRoot);
          setConfigPath(msg.configPath);
          setSel(null);
          setEditing(false);
          setNotices(msg.notices.map((n) => ({ ...n, id: noticeId.current++ })));
          if (gridRef.current) gridRef.current.scrollTop = 0;
          setScrollTop(0);
          setLoaded(true);
          break;
        case 'rowsChunk':
          setRows((prev) => prev.concat(msg.rows));
          break;
        case 'rowsUpdated':
          setRows((prev) => {
            const map = new Map(prev.map((row) => [row.id, row]));
            for (const id of msg.removedIds ?? []) map.delete(id);
            for (const row of msg.rows) map.set(row.id, row);
            return [...map.values()];
          });
          if (msg.stats) setStats(msg.stats);
          break;
        case 'fieldsUpdated':
          // 只换字段定义（例如选项池多了新值），不动行数据与界面状态
          setFields(msg.fields);
          break;
        case 'viewUpdated':
          setHidden(msg.view.hiddenColumns ?? []);
          setWidths(msg.view.columnWidths ?? {});
          setOrder(msg.view.columnOrder ?? msg.view.columnOrder ?? []);
          break;
        case 'viewsUpdated':
          // 视图列表变了（新建/复制/重命名/删除/切换）：只更新切换器，不动行数据与列状态
          setViews(msg.views);
          setViewId(msg.currentId);
          break;
        case 'notice':
          pushNotice(msg.notice.level, msg.notice.message);
          break;
        case 'cellResult':
          if (msg.error) {
            pushNotice('error', msg.error);
            setLocalCell(msg.id, msg.key, msg.value);
          }
          break;
      }
    };
    window.addEventListener('message', handler);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, [post, pushNotice, setLocalCell]);

  // 视口高度：虚拟滚动要知道可用高度。
  // 这个 effect 必须依赖 isCalendar——从日历切回表格时 .grid 是新的 DOM 元素，
  // 不重新挂 ResizeObserver 的话会一直沿用旧元素（甚至 0）的高度，
  // 表现就是表格只渲染最上面几行、下面全是空白。
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const height = el.clientHeight;
      // 面板被切到后台（retainContextWhenHidden）或元素正在被卸载时高度会是 0，
      // 这时不能写进状态，否则表格会退化成只剩 overscan 那几行。
      if (height > 0) setViewportH(height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isCalendar]);

  const fieldMap = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);

  const visibleFields = useMemo(() => {
    const hiddenSet = new Set(hidden);
    const ordered: ResolvedField[] = [];
    for (const key of order) {
      const field = fieldMap.get(key);
      if (field && !ordered.includes(field)) ordered.push(field);
    }
    for (const field of fields) {
      if (!ordered.includes(field)) ordered.push(field);
    }
    return ordered.filter((f) => {
      // 嵌套结构（值是对象/对象列表）默认不显示：只有配置里显式声明 visible: true 才作为只读列出现。
      // 不能交给视图的 hiddenColumns 决定，否则新出现的嵌套字段会变成一列噪音。
      if (f.complex) return f.source === 'config' && f.visible === true;
      return !hiddenSet.has(f.key);
    });
  }, [order, fields, fieldMap, hidden]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === '') return rows;
    return rows.filter((row) => {
      if (row.fileName.toLowerCase().includes(q) || row.relPath.toLowerCase().includes(q)) return true;
      for (const value of Object.values(row.values)) {
        if (cellToText(value).toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [rows, search]);


  /** 搜索与视图筛选都是前端完成的：切视图、改条件都不会触发重新扫描 */
  const visibleRows = useMemo(
    () => applyFilter(filtered, fieldMap, currentView.filter),
    [filtered, fieldMap, currentView],
  );

  const sortedRows = useMemo(
    () => sortRows(visibleRows, fieldMap, sort ? [sort] : []),
    [visibleRows, fieldMap, sort],
  );

  const filterActive = (currentView.filter?.conditions ?? []).length > 0 || search.trim() !== '';

  const totalWidth = useMemo(
    () => visibleFields.reduce((sum, field) => sum + (widths[field.key] ?? field.width), 0),
    [visibleFields, widths],
  );

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  // 测量还没成功（或面板不可见）时按 600px 估算，宁可多渲染几行也不能只渲染几行
  const visibleHeight = viewportH > 0 ? viewportH : FALLBACK_VIEWPORT_H;
  const end = Math.min(sortedRows.length, Math.ceil((scrollTop + visibleHeight) / ROW_H) + OVERSCAN);
  const slice = sortedRows.slice(start, end);

  const commitCell = useCallback(
    (row: RowData, key: string, value: CellValue, keepEditing = false) => {
      if (!keepEditing) setEditing(false);
      setLocalCell(row.id, key, value);
      post({ type: 'setCell', id: row.id, key, value });
    },
    [post, setLocalCell],
  );

  const clearCell = useCallback(
    (row: RowData, field: ResolvedField) => {
      if (field.key === FILE_COLUMN_KEY || field.complex) return;
      const empty: CellValue = field.type === 'select' || field.type === 'multiSelect' ? [] : null;
      setLocalCell(row.id, field.key, empty);
      post({ type: 'clearCell', id: row.id, key: field.key });
    },
    [post, setLocalCell],
  );

  const editorCallbacks = useCallback(
    (row: RowData, field: ResolvedField): EditorCallbacks => ({
      onCommit: (value, keepEditing) => commitCell(row, field.key, value, keepEditing),
      onCancel: () => setEditing(false),
      onAddOption: (option) => post({ type: 'addOption', key: field.key, value: option }),
      onInvalid: (message) => pushNotice('error', message),
    }),
    [commitCell, post, pushNotice],
  );

  /** 视图配置的本地更新：界面自己先改，再把改动发给宿主机持久化 */
  const patchViewLocal = useCallback((id: string, patch: Partial<ViewConfig>) => {
    setViews((prev) => prev.map((view) => (view.id === id ? { ...view, ...patch } : view)));
  }, []);

  /**
   * 筛选条件改动：必须先在界面本地生效再发给宿主机。
   * 宿主对 setViewFilter 是「只持久化、不回传数据」的，如果界面不自己更新，
   * 就会出现「点了添加条件/清除没反应，必须刷新」的现象（v0.2.0 的 bug）。
   */
  const handleFilterChange = useCallback(
    (id: string, filter: ViewFilter) => {
      patchViewLocal(id, { filter });
      post({ type: 'setViewFilter', viewId: id, filter });
    },
    [patchViewLocal, post],
  );

  const cycleSort = (key: string) => {
    setSort((prev) => {
      let next: { key: string; direction: SortDirection } | null;
      if (!prev || prev.key !== key) next = { key, direction: 'asc' };
      else if (prev.direction === 'asc') next = { key, direction: 'desc' };
      else next = null;
      post({ type: 'setSort', key: next?.key ?? null, direction: next?.direction ?? 'asc' });
      return next;
    });
  };

  const toggleHidden = (key: string, makeVisible: boolean) => {
    setHidden((prev) => (makeVisible ? prev.filter((k) => k !== key) : [...prev, key]));
    post({ type: 'setColumnVisible', key, visible: makeVisible });
  };

  /** 拖动列头调整列顺序（「文件名」列固定在最左，不参与拖动） */
  const dropColumn = (targetKey: string) => {
    const from = dragKey;
    setDragKey(null);
    setDragOverKey(null);
    if (!from || from === targetKey) return;
    const current = visibleFields.map((f) => f.key);
    const fromIndex = current.indexOf(from);
    const toIndex = current.indexOf(targetKey);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...current];
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, from);
    // 隐藏的列排在后面，保持它们原有相对顺序
    const rest = order.filter((k) => !current.includes(k));
    const full = [...next, ...rest];
    setOrder(full);
    post({ type: 'setColumnOrder', order: full });
  };

  const startResize = (event: React.MouseEvent, key: string) => {
    event.preventDefault();
    event.stopPropagation();
    // 拖动列宽期间关掉列头的原生拖拽，否则会变成拖列顺序
    const header = (event.currentTarget as HTMLElement).parentElement;
    if (header) header.draggable = false;
    const startX = event.clientX;
    const startWidth = widths[key] ?? fieldMap.get(key)?.width ?? 160;
    let latest = startWidth;
    const onMove = (e: MouseEvent) => {
      latest = Math.max(60, Math.round(startWidth + (e.clientX - startX)));
      setWidths((prev) => ({ ...prev, [key]: latest }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (header) header.draggable = true;
      post({ type: 'setColumnWidth', key, width: latest });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const moveSelection = (row: number, col: number) => {
    const rowCount = sortedRows.length;
    const colCount = visibleFields.length;
    if (rowCount === 0 || colCount === 0) return;
    const r = Math.max(0, Math.min(rowCount - 1, row));
    const c = Math.max(0, Math.min(colCount - 1, col));
    setSel({ row: r, col: c });
    setEditing(false);
    const container = gridRef.current;
    if (container) {
      const top = r * ROW_H;
      const visibleTop = container.scrollTop;
      const visibleBottom = visibleTop + container.clientHeight - HEADER_H;
      if (top < visibleTop) container.scrollTop = top;
      else if (top + ROW_H > visibleBottom) container.scrollTop = top + ROW_H - container.clientHeight + HEADER_H;
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const current = sel ?? { row: 0, col: 0 };
    const field = visibleFields[current.col];
    const row = sortedRows[current.row];
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveSelection(current.row + 1, current.col);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveSelection(current.row - 1, current.col);
        break;
      case 'ArrowRight':
        event.preventDefault();
        moveSelection(current.row, current.col + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        moveSelection(current.row, current.col - 1);
        break;
      case 'Tab':
        event.preventDefault();
        moveSelection(current.row, current.col + (event.shiftKey ? -1 : 1));
        break;
      case 'Enter':
      case 'F2': {
        event.preventDefault();
        if (field && row && field.key !== FILE_COLUMN_KEY && !field.complex && row.hasFrontmatter && !row.parseError) {
          setSel({ row: current.row, col: current.col });
          setEditing(true);
        }
        break;
      }
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        if (field && row) clearCell(row, field);
        break;
      default:
        break;
    }
  };

  const isEmpty = loaded && fields.length === 0;

  return (
    <div className="app">
      <div className="toolbar">
        <ViewSwitcher views={views} current={currentView} post={post} />
        <button className="primary" onClick={() => post({ type: 'refresh' })}>
          刷新
        </button>
        <input
          className="search"
          type="search"
          placeholder="搜索文件名或字段值…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {!isCalendar && (
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowFields((v) => !v)}>
            字段（{visibleFields.length}/{fields.length}）
          </button>
          {showFields && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setShowFields(false)} />
              <div className="panel" style={{ top: '100%', left: 0 }}>
                {fields.map((field) => {
                  const locked = field.complex;
                  return (
                    <div
                      className={`row-item${locked ? ' disabled' : ''}`}
                      key={field.key}
                      title={locked ? '嵌套结构（值是对象或对象列表），只能在配置里把该字段的 visible 设为 true 才会以只读列显示' : undefined}
                      onClick={() => {
                        if (!locked) toggleHidden(field.key, hidden.includes(field.key));
                      }}
                    >
                      <input type="checkbox" checked={!locked && !hidden.includes(field.key)} disabled={locked} readOnly />
                      <span>{field.label}</span>
                      <span className="key">
                        {field.key} · {typeLabel(field.type)}
                        {locked ? ' · 嵌套结构，不显示' : field.optionsAuto ? '' : ' · 固定选项池'}
                      </span>
                    </div>
                  );
                })}
                <hr />
                <div className="row-item" onClick={() => post({ type: 'openConfig' })} title={configPath}>
                  打开配置文件…
                </div>
                <div className="row-item" onClick={() => post({ type: 'resetColumnWidths' })}>
                  重置所有列宽
                </div>
              </div>
            </>
          )}
        </div>
        )}
        <button onClick={() => post({ type: 'openConfig' })} title={configPath}>
          配置
        </button>
        {!isCalendar && (
          <label className="toggle" title="这些文件没有 front matter，默认不显示；打开后可对单行点「补骨架」">
            <input
              type="checkbox"
              checked={showWithout}
              onChange={(e) => {
                setShowWithout(e.target.checked);
                post({ type: 'toggleShowWithoutFrontmatter', show: e.target.checked });
              }}
            />
            显示无 front matter 的文件
          </label>
        )}
        <div className="spacer" />
        {!isCalendar && (
          <span className="stats" title={`扫描根目录：${scopeRoot}`}>
            {filterActive ? `显示 ${sortedRows.length} / 共 ${rows.length} 行` : `${stats.shown} 个文件`} ·{' '}
            {stats.unparsable} 个无法解析 · 已隐藏 {stats.withoutFrontmatter} 个无前置信息
            {stats.optionsTruncated ? ' · 选项池已截断' : ''}
          </span>
        )}
      </div>

      {fields.length > 0 && (
        <FilterBar view={currentView} fields={fields} fieldMap={fieldMap} onFilterChange={handleFilterChange} />
      )}

      {notices.length > 0 && (
        <div className="toasts" role="status" aria-live="polite">
          {notices.map((notice) => (
            <div className={`toast ${notice.level}`} key={notice.id}>
              <span className="icon" aria-hidden="true">
                {notice.level === 'error' ? '✕' : notice.level === 'warn' ? '⚠' : 'ℹ'}
              </span>
              <span className="msg">{notice.message}</span>
              <button title="关闭" onClick={() => setNotices((prev) => prev.filter((n) => n.id !== notice.id))}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {isCalendar ? (
        <CalendarView
          view={currentView}
          rows={sortedRows}
          fields={fields}
          post={post}
          onSetCell={(row, key, value) => commitCell(row, key, value)}
        />
      ) : (
      <div
        className="grid"
        ref={gridRef}
        tabIndex={0}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        onKeyDown={onKeyDown}
        onMouseDown={() => gridRef.current?.focus()}
      >
        {isEmpty ? (
          <div className="empty-state">
            没有可显示的 markdown 文件。请检查配置里的 <code>scope.root</code> 与忽略清单（点击工具栏「配置」）。
          </div>
        ) : (
          <div className="grid-content" style={{ width: totalWidth }}>
            <div className="header-row" style={{ width: totalWidth }}>
              {visibleFields.map((field) => {
                const active = sort?.key === field.key;
                const draggable = field.key !== FILE_COLUMN_KEY;
                return (
                  <div
                    className={`th${field.source === 'inferred' ? ' inferred' : ''}${dragOverKey === field.key ? ' drop-target' : ''}${
                      dragKey === field.key ? ' dragging' : ''
                    }`}
                    key={field.key}
                    style={{ width: widths[field.key] ?? field.width }}
                    draggable={draggable}
                    title={`${field.label}（${field.key}）· ${typeLabel(field.type)}${
                      field.source === 'inferred' ? ' · 类型为自动推断，可在配置里声明' : ''
                    }\n单击排序 · 拖动列头调整顺序 · 右键隐藏此列 · 拖动右边缘改宽度`}
                    onClick={() => cycleSort(field.key)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      toggleHidden(field.key, false);
                    }}
                    onDragStart={(e) => {
                      if (!draggable) return;
                      setDragKey(field.key);
                      // 某些环境（Firefox）必须设置数据才会触发 drop
                      e.dataTransfer?.setData('text/plain', field.key);
                    }}
                    onDragOver={(e) => {
                      if (!dragKey || dragKey === field.key) return;
                      e.preventDefault();
                      setDragOverKey(field.key);
                    }}
                    onDragLeave={() => {
                      setDragOverKey((prev) => (prev === field.key ? null : prev));
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      dropColumn(field.key);
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setDragOverKey(null);
                    }}
                  >
                    <span>{field.label}</span>
                    {active && <span className="sort">{sort?.direction === 'asc' ? '▲' : '▼'}</span>}
                    <span className="sizer" onMouseDown={(e) => startResize(e, field.key)} />
                  </div>
                );
              })}
            </div>

            <div className="rows" style={{ height: sortedRows.length * ROW_H }}>
              {slice.map((row, index) => {
                const rowIndex = start + index;
                const isSelRow = sel?.row === rowIndex;
                return (
                  <div
                    className={`row${isSelRow ? ' selected-row' : ''}`}
                    key={row.id}
                    style={{ top: rowIndex * ROW_H, height: ROW_H, width: totalWidth }}
                  >
                    {visibleFields.map((field, colIndex) => {
                      const width = widths[field.key] ?? field.width;
                      const selected = isSelRow && sel?.col === colIndex;
                      const value = row.values[field.key] ?? null;

                      if (field.key === FILE_COLUMN_KEY) {
                        return (
                          <div
                            className={`td file-cell${selected ? ' cell-selected' : ''}`}
                            key={field.key}
                            style={{ width }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSel({ row: rowIndex, col: colIndex });
                              setEditing(false);
                            }}
                          >
                            <div className="file-wrap">
                              {row.parseError && (
                                <span className="warn-mark" title={`front matter 无法解析：${row.parseError}`}>
                                  ⚠
                                </span>
                              )}
                              <span
                                className={`file-name${row.parseError ? ' row-error' : ''}`}
                                title={row.parseError ? `${row.relPath}\n\nfront matter 无法解析：${row.parseError}` : row.relPath}
                                onClick={() => post({ type: 'openFile', id: row.id })}
                              >
                                {row.fileName.replace(/\.md$/i, '')}
                              </span>
                              {!row.hasFrontmatter && (
                                <button
                                  className="skeleton-btn"
                                  title="为这个文件在顶部补上 front matter 骨架"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    post({ type: 'addSkeleton', id: row.id });
                                  }}
                                >
                                  补骨架
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <Cell
                          key={field.key}
                          field={field}
                          value={value}
                          width={width}
                          selected={selected}
                          editing={selected && editing}
                          rowHasFrontmatter={row.hasFrontmatter}
                          rowError={row.parseError}
                          onSelect={() => {
                            setSel({ row: rowIndex, col: colIndex });
                            setEditing(false);
                          }}
                          onStartEdit={() => {
                            setSel({ row: rowIndex, col: colIndex });
                            setEditing(true);
                          }}
                          onToggleCheckbox={(next) => {
                            setSel({ row: rowIndex, col: colIndex });
                            if (next === null) clearCell(row, field);
                            else commitCell(row, field.key, next);
                          }}
                          editor={editorCallbacks(row, field)}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
