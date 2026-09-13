import { useMemo, useState } from 'react';
import { buildMonthMatrix, dateKeyOf, monthLabel, shiftMonth, toDateKey, WEEKDAYS } from '../shared/calendar';
import type { CellValue, ResolvedField, RowData, ViewConfig, WebviewToHost } from '../shared/types';

export interface CalendarViewProps {
  view: ViewConfig;
  /** 已经过搜索与视图筛选的行 */
  rows: RowData[];
  fields: ResolvedField[];
  post: (message: WebviewToHost) => void;
  /** 拖拽改日期：界面先本地生效再写盘 */
  onSetCell: (row: RowData, key: string, value: CellValue) => void;
}

/**
 * 月视图。
 * - 只渲染「日期字段不为空」的笔记；不硬编码 date，日期字段由视图配置决定
 * - 点卡片打开文件；把卡片拖到另一天直接改日期（复用表格的写回通道，所以同样有冲突检测与撤销）
 * - 复用 v2 的筛选：传进来的 rows 已经筛过了
 */
export function CalendarView({ view, rows, fields, post, onSetCell }: CalendarViewProps): JSX.Element {
  const today = new Date();
  const todayKey = toDateKey(today);
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);

  const dateFields = useMemo(() => fields.filter((f) => f.type === 'date' && !f.complex), [fields]);
  const dateField = dateFields.find((f) => f.key === view.dateField) ?? dateFields[0];

  const titleField = useMemo(() => fields.find((f) => f.key === 'title'), [fields]);

  const { byDay, undated } = useMemo(() => {
    const map = new Map<string, RowData[]>();
    const missing: RowData[] = [];
    if (!dateField) return { byDay: map, undated: rows };
    for (const row of rows) {
      const key = dateKeyOf(row.values[dateField.key]);
      if (key) {
        const list = map.get(key);
        if (list) list.push(row);
        else map.set(key, [row]);
      } else {
        missing.push(row);
      }
    }
    return { byDay: map, undated: missing };
  }, [rows, dateField]);

  const weeks = useMemo(() => buildMonthMatrix(cursor.year, cursor.month), [cursor]);
  const monthCount = useMemo(
    () => weeks.flat().filter((day) => day.inMonth).reduce((sum, day) => sum + (byDay.get(day.key)?.length ?? 0), 0),
    [weeks, byDay],
  );

  const labelOf = (row: RowData): string => {
    const raw = titleField ? row.values[titleField.key] : null;
    const text = raw === null || raw === undefined ? '' : String(raw).trim();
    return text !== '' ? text : row.fileName.replace(/\.md$/i, '');
  };

  const reschedule = (rowId: string, dayKey: string) => {
    setDragId(null);
    setDropKey(null);
    const row = rows.find((r) => r.id === rowId);
    if (!row || !dateField) return;
    onSetCell(row, dateField.key, dayKey);
  };

  if (!dateField) {
    return (
      <div className="empty-state">
        这个日历视图还没有可用的日期字段。请在 <code>.mattertable/config.json</code> 里给某个字段声明{' '}
        <code>"type": "date"</code>，它就会出现在这里供选择。
      </div>
    );
  }

  const allUndated = rows.length > 0 && undated.length === rows.length;

  return (
    <div className="calendar">
      <div className="cal-toolbar">
        <button onClick={() => setCursor(shiftMonth(cursor.year, cursor.month, -1))} title="上个月">
          ‹
        </button>
        <button onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })} title="回到本月">
          今天
        </button>
        <button onClick={() => setCursor(shiftMonth(cursor.year, cursor.month, 1))} title="下个月">
          ›
        </button>
        <span className="cal-month">{monthLabel(cursor.year, cursor.month)}</span>
        <span className="cal-hint">拖动卡片到另一天即可改日期</span>
        <div className="spacer" />
        <label className="cal-field" title="用哪个字段作为日期（可在配置里改字段类型）">
          日期字段
          <select
            value={dateField.key}
            onChange={(e) => post({ type: 'setViewDateField', viewId: view.id, dateField: e.target.value })}
          >
            {dateFields.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
          </select>
        </label>
        <span className="stats">
          本月 {monthCount} 项
          {undated.length > 0 ? ` · 另有 ${undated.length} 项没有日期` : ''}
        </span>
      </div>

      {allUndated && (
        <div className="cal-warn">
          当前筛选结果里没有任何笔记填写了「{dateField.label}」，所以日历是空的。
        </div>
      )}

      <div className="cal-weekdays">
        {WEEKDAYS.map((label, index) => (
          <div key={label} className={index >= 5 ? 'weekend' : ''}>
            {label}
          </div>
        ))}
      </div>

      <div className="cal-grid" data-testid="calendar-grid">
        {weeks.flat().map((day) => {
          const items = byDay.get(day.key) ?? [];
          return (
            <div
              key={day.key}
              data-day={day.key}
              className={`cal-day${day.inMonth ? '' : ' out'}${day.key === todayKey ? ' today' : ''}${
                dropKey === day.key ? ' drop' : ''
              }`}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setDropKey(day.key);
              }}
              onDragLeave={() => setDropKey((prev) => (prev === day.key ? null : prev))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) reschedule(dragId, day.key);
              }}
            >
              <div className="cal-daynum">{day.day}</div>
              <div className="cal-items">
                {items.map((row) => (
                  <div
                    key={row.id}
                    className={`cal-item${dragId === row.id ? ' dragging' : ''}`}
                    draggable
                    title={`${row.relPath}\n单击打开文件 · 拖到另一天改「${dateField.label}」`}
                    onDragStart={(e) => {
                      setDragId(row.id);
                      e.dataTransfer?.setData('text/plain', row.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropKey(null);
                    }}
                    onClick={() => post({ type: 'openFile', id: row.id })}
                  >
                    {labelOf(row)}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
