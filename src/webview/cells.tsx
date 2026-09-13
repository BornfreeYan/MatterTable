import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CellValue, ResolvedField } from '../shared/types';
import { isEmptyValue, listItems } from '../shared/values';

export interface EditorCallbacks {
  /**
   * keepEditing = true 时不关闭编辑器。
   * 多选里每加一个标签就立刻写盘（keepEditing），最后再收摊，
   * 这样中途被任何刷新打断都不会丢已输入的标签。
   */
  onCommit: (value: CellValue, keepEditing?: boolean) => void;
  onCancel: () => void;
  onAddOption: (value: string) => void;
  onInvalid: (message: string) => void;
}

const POPUP_MAX_HEIGHT = 260;

const HIDDEN: React.CSSProperties = { position: 'fixed', top: 0, left: 0, visibility: 'hidden' };

/**
 * 把下拉面板贴到单元格下方（用 portal 渲染，避免被表格滚动容器裁掉）。
 * anchor 是单元格自己的 DOM 元素，随滚动/缩放实时重新定位。
 */
function usePopupStyle(anchor: HTMLElement | null): React.CSSProperties {
  const [style, setStyle] = useState<React.CSSProperties>(HIDDEN);
  useEffect(() => {
    if (!anchor) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.max(Math.round(rect.width), 200);
      const left = Math.min(Math.max(8, Math.round(rect.left)), Math.max(8, window.innerWidth - width - 8));
      const roomBelow = window.innerHeight - rect.bottom > 120;
      if (roomBelow) {
        setStyle({
          position: 'fixed',
          left,
          top: Math.round(rect.bottom) + 2,
          minWidth: width,
          maxWidth: Math.min(440, window.innerWidth - 16),
          maxHeight: POPUP_MAX_HEIGHT,
          visibility: 'visible',
        });
      } else {
        setStyle({
          position: 'fixed',
          left,
          top: Math.max(8, Math.round(rect.top) - 4),
          minWidth: width,
          maxWidth: Math.min(440, window.innerWidth - 16),
          maxHeight: POPUP_MAX_HEIGHT,
          transform: 'translateY(-100%)',
          visibility: 'visible',
        });
      }
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchor]);
  return style;
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void): void {
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      if (event.target instanceof Node && !el.contains(event.target)) onOutside();
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [ref, onOutside]);
}

interface PopupItem {
  value: string;
  create?: boolean;
  undef?: boolean;
}

function SelectEditor({
  field,
  value,
  anchor,
  onCommit,
  onCancel,
  onAddOption,
}: { field: ResolvedField; value: CellValue; anchor: HTMLElement | null } & Omit<EditorCallbacks, 'onInvalid'>) {
  const current = listItems(value)[0] ?? '';
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const style = usePopupStyle(anchor);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useClickOutside(ref, onCancel);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo<PopupItem[]>(() => {
    const q = query.trim().toLowerCase();
    const list: PopupItem[] = field.options
      .filter((o) => (q === '' ? true : o.toLowerCase().includes(q)))
      .map((option) => ({ value: option }));
    if (current !== '' && !field.options.includes(current) && (q === '' || current.toLowerCase().includes(q))) {
      list.unshift({ value: current, undef: true });
    }
    const exact = field.options.includes(query.trim()) || current === query.trim();
    if (query.trim() !== '' && !exact) list.push({ value: query.trim(), create: true });
    return list;
  }, [field.options, query, current]);

  const pick = (item: PopupItem) => {
    if (item.create) onAddOption(item.value);
    onCommit(item.value);
  };

  return createPortal(
    <div className="popup" style={style} ref={ref} data-testid="select-popup">
      <input
        ref={inputRef}
        className="popup-search"
        autoFocus
        placeholder="搜索或输入新选项…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const item = items[highlight] ?? items.find((i) => i.create);
            if (item) pick(item);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(items.length - 1, h + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(0, h - 1));
          }
        }}
      />
      <div className="popup-list">
        {items.length === 0 && <div className="popup-empty">没有匹配的选项</div>}
        {items.map((item, index) => (
          <div
            key={`${item.value}-${index}`}
            className={`popup-item${index === highlight ? ' hl' : ''}${item.create ? ' create' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(item);
            }}
          >
            <span>{item.create ? `新建选项「${item.value}」` : item.value}</span>
            {item.undef && <span className="hint">未定义</span>}
            {item.value === current && <span className="hint">当前</span>}
          </div>
        ))}
        <div
          className="popup-item clear"
          onMouseDown={(e) => {
            e.preventDefault();
            onCommit(null);
          }}
        >
          清空
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MultiSelectEditor({
  field,
  value,
  anchor,
  onCommit,
  onAddOption,
}: { field: ResolvedField; value: CellValue; anchor: HTMLElement | null } & Omit<EditorCallbacks, 'onInvalid' | 'onCancel'>) {
  const [chips, setChips] = useState<string[]>(() => listItems(value));
  const [query, setQuery] = useState('');
  const style = usePopupStyle(anchor);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useClickOutside(ref, () => onCommit(chips));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return field.options
      .filter((o) => !chips.includes(o))
      .filter((o) => (q === '' ? true : o.toLowerCase().includes(q)))
      .slice(0, 40);
  }, [field.options, chips, query]);

  /** 每加/删一个标签就立刻写盘（keepEditing），最后再收摊，避免中途被刷新打断丢内容 */
  const applyChips = (next: string[], keepEditing: boolean) => {
    setChips(next);
    onCommit(next, keepEditing);
  };

  const addChip = (raw: string) => {
    const v = raw.trim();
    if (v === '' || chips.includes(v)) return;
    if (!field.options.includes(v)) onAddOption(v);
    applyChips([...chips, v], true);
  };

  return createPortal(
    <div className="popup" style={style} ref={ref} data-testid="multiselect-popup">
      <div className="chips">
        {chips.map((chip) => (
          <span className="chip chip-edit" key={chip}>
            {chip}
            <button
              title="移除"
              onMouseDown={(e) => {
                e.preventDefault();
                applyChips(
                  chips.filter((c) => c !== chip),
                  true,
                );
              }}
            >
              ×
            </button>
          </span>
        ))}
        {chips.length === 0 && <span className="hint">还没有标签</span>}
      </div>
      <input
        ref={inputRef}
        className="popup-search"
        autoFocus
        placeholder="输入后回车添加标签…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCommit(chips);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (query.trim() !== '') {
              addChip(query);
              setQuery('');
            } else {
              onCommit(chips);
            }
          } else if (e.key === 'Backspace' && query === '' && chips.length > 0) {
            e.preventDefault();
            applyChips(chips.slice(0, -1), true);
          }
        }}
      />
      <div className="popup-list">
        {suggestions.map((item) => (
          <div
            key={item}
            className="popup-item"
            onMouseDown={(e) => {
              e.preventDefault();
              addChip(item);
              setQuery('');
            }}
          >
            {item}
          </div>
        ))}
        {query.trim() !== '' && !field.options.includes(query.trim()) && !chips.includes(query.trim()) && (
          <div
            className="popup-item create"
            onMouseDown={(e) => {
              e.preventDefault();
              addChip(query);
              setQuery('');
            }}
          >
            新建标签「{query.trim()}」
          </div>
        )}
        <div
          className="popup-item clear"
          onMouseDown={(e) => {
            e.preventDefault();
            applyChips([], true);
          }}
        >
          清空
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TextEditor({
  value,
  numeric,
  onCommit,
  onCancel,
  onInvalid,
}: { value: CellValue; numeric: boolean } & Pick<EditorCallbacks, 'onCommit' | 'onCancel' | 'onInvalid'>) {
  const initial = Array.isArray(value) ? value.join(', ') : value === null ? '' : String(value);
  const [text, setText] = useState(initial);
  const committed = useRef(false);
  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    const trimmed = text.trim();
    if (numeric) {
      if (trimmed === '') {
        onCommit(null);
        return;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        onInvalid(`「${text}」不是合法数字，已放弃这次修改`);
        onCancel();
        return;
      }
      onCommit(parsed);
      return;
    }
    onCommit(trimmed === '' ? null : text);
  };
  return (
    <input
      className="editor-input"
      autoFocus
      // 刻意用 text 而不是 number：number 输入框会把字母直接吞掉，
      // 用户看不到任何反馈；用 text 才能给「不是合法数字」的明确提示。
      type="text"
      inputMode={numeric ? 'decimal' : undefined}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          committed.current = true;
          onCancel();
        }
      }}
    />
  );
}

function DateEditor({
  value,
  onCommit,
  onCancel,
}: { value: CellValue } & Pick<EditorCallbacks, 'onCommit' | 'onCancel'>) {
  const initial = value === null || Array.isArray(value) ? '' : String(value);
  const [text, setText] = useState(/^\d{4}-\d{2}-\d{2}$/.test(initial) ? initial : '');
  const committed = useRef(false);
  const commit = (next: string) => {
    if (committed.current) return;
    committed.current = true;
    onCommit(next === '' ? null : next);
  };
  return (
    <input
      className="editor-input"
      autoFocus
      type="date"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value !== '') commit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          committed.current = true;
          onCancel();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          commit(text);
        }
      }}
    />
  );
}

export interface CellProps {
  field: ResolvedField;
  value: CellValue;
  width: number;
  selected: boolean;
  editing: boolean;
  rowHasFrontmatter: boolean;
  rowError?: string;
  onSelect: () => void;
  onStartEdit: () => void;
  onToggleCheckbox: (next: boolean | null) => void;
  editor: EditorCallbacks;
}

/**
 * 一个单元格。展示态与编辑态渲染的是**同一个** div：
 * 这样进入编辑时 DOM 元素不会被替换，下拉面板的锚点始终有效。
 *
 * 交互按电子表格习惯：单击只选中，再单击（或双击 / Enter / F2）才进入编辑，
 * 这样「选中后按 Delete 清空」才是一条走得通的路径。
 */
export function Cell({
  field,
  value,
  width,
  selected,
  editing,
  rowHasFrontmatter,
  rowError,
  onSelect,
  onStartEdit,
  onToggleCheckbox,
  editor,
}: CellProps) {
  const tdRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const editable = rowHasFrontmatter && !field.complex && !rowError;

  useEffect(() => {
    if (editing) setAnchor(tdRef.current);
  }, [editing]);

  if (field.type === 'checkbox') {
    const state = value === true ? 'checked' : value === false ? 'unchecked' : 'unset';
    return (
      <div
        className={`td centered${selected ? ' cell-selected' : ''}${editable ? '' : ' ro'}`}
        style={{ width }}
        ref={tdRef}
        title={editable ? '单击切换；选中后按 Delete 清空' : rowError ? `无法编辑：${rowError}` : '不可编辑'}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
          if (!editable) return;
          onToggleCheckbox(state !== 'checked');
        }}
      >
        <span className="check">{state === 'checked' ? '✓' : state === 'unchecked' ? '·' : ''}</span>
      </div>
    );
  }

  const isList = field.type === 'select' || field.type === 'multiSelect';
  const chips = isList
    ? listItems(value).map((text) => ({ text, undef: !field.options.includes(text) }))
    : [];
  const plain = isList || field.complex || isEmptyValue(value) ? '' : String(value);

  return (
    <div
      className={`td${selected ? ' cell-selected' : ''}${editable ? '' : ' ro'}${field.complex ? ' complex' : ''}`}
      style={{ width }}
      ref={tdRef}
      title={rowError ? `无法编辑：${rowError}` : plain !== '' ? plain : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (editing) return;
        if (editable && selected) onStartEdit();
        else onSelect();
      }}
    >
      {editing ? (
        field.type === 'select' ? (
          <SelectEditor field={field} value={value} anchor={anchor} {...editor} />
        ) : field.type === 'multiSelect' ? (
          <MultiSelectEditor field={field} value={value} anchor={anchor} {...editor} />
        ) : field.type === 'date' ? (
          <DateEditor value={value} onCommit={editor.onCommit} onCancel={editor.onCancel} />
        ) : (
          <TextEditor
            value={value}
            numeric={field.type === 'number'}
            onCommit={editor.onCommit}
            onCancel={editor.onCancel}
            onInvalid={editor.onInvalid}
          />
        )
      ) : field.complex ? (
        <span className="value">（嵌套结构，只读）</span>
      ) : chips.length > 0 ? (
        <span className="value">
          {chips.map((chip, index) => (
            <span
              key={`${chip.text}-${index}`}
              className={`chip${chip.undef ? ' undef' : ''}`}
              title={chip.undef ? `${chip.text}（不在选项池里）` : chip.text}
            >
              {chip.text}
            </span>
          ))}
        </span>
      ) : (
        <span className="value">{plain}</span>
      )}
    </div>
  );
}
