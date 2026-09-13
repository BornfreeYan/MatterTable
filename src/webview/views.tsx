import { useState } from 'react';
import {
  defaultCondition,
  describeCondition,
  fieldFor,
  isEmptyFilter,
  newConditionId,
  operatorDef,
  operatorsFor,
} from '../shared/filter';
import type { OperatorDef } from '../shared/filter';
import type {
  FilterCondition,
  ResolvedField,
  ScopeConfig,
  ViewConfig,
  ViewFilter,
  WebviewToHost,
} from '../shared/types';

interface CommonProps {
  post: (message: WebviewToHost) => void;
}

function summarizeScope(view: ViewConfig): string {
  const scope = view.scope;
  if (!scope) return '';
  const parts: string[] = [];
  if (scope.root) parts.push(`路径 ${scope.root}`);
  if (scope.exclude && scope.exclude.length > 0) parts.push(`${scope.exclude.length} 条忽略`);
  return parts.join(' · ');
}

function summarizeFilter(view: ViewConfig): string {
  const count = (view.filter?.conditions ?? []).length;
  return count === 0 ? '未筛选' : `${count} 个条件`;
}

function typeLabelOf(view: ViewConfig): string {
  return view.type === 'calendar' ? '日历' : '表格';
}

/* ------------------------------------------------------------------ 视图切换器 */

type MenuMode = 'list' | 'create' | 'rename' | 'scope';

export function ViewSwitcher({
  views,
  current,
  post,
}: CommonProps & { views: ViewConfig[]; current: ViewConfig }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<MenuMode>('list');
  const [draft, setDraft] = useState('');
  const [createType, setCreateType] = useState<'table' | 'calendar'>('table');

  const close = () => {
    setOpen(false);
    setMode('list');
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          setMode('list');
        }}
        title="切换视图 / 新建 / 重命名 / 设置扫描范围"
      >
        视图：{current.name} ▾
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={close} />
          <div className="panel" style={{ top: '100%', left: 0, minWidth: 320 }}>
            {mode === 'list' && (
              <>
                {views.map((view) => (
                  <div
                    key={view.id}
                    className={`row-item${view.id === current.id ? ' current' : ''}`}
                    onClick={() => {
                      if (view.id !== current.id) post({ type: 'switchView', viewId: view.id });
                      close();
                    }}
                  >
                    <span className="mark">{view.id === current.id ? '●' : '○'}</span>
                    <span>{view.name}</span>
                    <span className="key">
                      {typeLabelOf(view)} · {summarizeFilter(view)}
                      {summarizeScope(view) ? ` · ${summarizeScope(view)}` : ''}
                    </span>
                  </div>
                ))}
                <hr />
                <div
                  className="row-item"
                  onClick={() => {
                    setCreateType('table');
                    setMode('create');
                    setDraft('');
                  }}
                >
                  ＋ 新建表格视图（不含筛选条件）
                </div>
                <div
                  className="row-item"
                  onClick={() => {
                    setCreateType('calendar');
                    setMode('create');
                    setDraft('');
                  }}
                >
                  ＋ 新建日历视图（按日期字段铺到月历上）
                </div>
                <div
                  className="row-item"
                  onClick={() => {
                    post({ type: 'duplicateView', viewId: current.id });
                    close();
                  }}
                >
                  ⧉ 复制当前视图（含筛选条件与列设置）
                </div>
                <div
                  className="row-item"
                  onClick={() => {
                    setMode('rename');
                    setDraft(current.name);
                  }}
                >
                  ✎ 重命名当前视图
                </div>
                <div className="row-item" onClick={() => setMode('scope')}>
                  ⌂ 当前视图的扫描范围…
                </div>
                <div
                  className={`row-item${views.length <= 1 ? ' disabled' : ''}`}
                  title={views.length <= 1 ? '至少要保留一个视图' : undefined}
                  onClick={() => {
                    if (views.length <= 1) return;
                    post({ type: 'deleteView', viewId: current.id });
                    close();
                  }}
                >
                  ✕ 删除当前视图
                </div>
              </>
            )}

            {mode === 'create' && (
              <InlineNameForm
                label={createType === 'calendar' ? '新日历视图名称' : '新表格视图名称'}
                placeholder={createType === 'calendar' ? '例如：发布日历' : '例如：CS 笔记'}
                value={draft}
                onChange={setDraft}
                onCancel={() => setMode('list')}
                onSubmit={() => {
                  post({ type: 'createView', name: draft, copyCurrent: false, viewType: createType });
                  close();
                }}
              />
            )}

            {mode === 'rename' && (
              <InlineNameForm
                label="重命名视图"
                placeholder="视图名称"
                value={draft}
                onChange={setDraft}
                onCancel={() => setMode('list')}
                onSubmit={() => {
                  if (draft.trim() !== '') post({ type: 'renameView', viewId: current.id, name: draft });
                  close();
                }}
              />
            )}

            {mode === 'scope' && (
              <ScopeForm
                view={current}
                onCancel={() => setMode('list')}
                onSubmit={(scope) => {
                  post({ type: 'setViewScope', viewId: current.id, scope });
                  close();
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function InlineNameForm({
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div className="inline-form">
      <div className="key" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="inline-actions">
        <button className="primary" onClick={onSubmit}>
          确定
        </button>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

function ScopeForm({
  view,
  onSubmit,
  onCancel,
}: {
  view: ViewConfig;
  onSubmit: (scope: ScopeConfig) => void;
  onCancel: () => void;
}): JSX.Element {
  const [root, setRoot] = useState(view.scope?.root ?? '');
  const [exclude, setExclude] = useState((view.scope?.exclude ?? []).join('\n'));
  return (
    <div className="inline-form" data-testid="scope-form">
      <div className="key">扫描根目录（留空 = 用全局配置的 scope.root，也就是当前工作区）</div>
      <input
        autoFocus
        value={root}
        placeholder="例如 D:\KnowledgeBase\3 Agent Dev"
        onChange={(e) => setRoot(e.target.value)}
      />
      <div className="key" style={{ marginTop: 6 }}>
        额外忽略（每行一条 glob，会与全局忽略清单取并集）
      </div>
      <textarea
        rows={3}
        value={exclude}
        placeholder={'例如\n**/Raw/**'}
        onChange={(e) => setExclude(e.target.value)}
      />
      <div className="inline-actions">
        <button
          className="primary"
          onClick={() =>
            onSubmit({
              root: root.trim(),
              exclude: exclude
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line !== ''),
            })
          }
        >
          保存并重新扫描
        </button>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- 筛选条件 */

function ValueEditor({
  field,
  def,
  value,
  onChange,
}: {
  field: ResolvedField | undefined;
  def: OperatorDef;
  value: FilterCondition['value'];
  onChange: (value: FilterCondition['value']) => void;
}): JSX.Element | null {
  if (!def.needsValue) return null;

  if (def.valueKind === 'checkbox') {
    const current = value === true || value === 'true' ? 'true' : 'false';
    return (
      <select value={current} onChange={(e) => onChange(e.target.value === 'true')} title="已勾选 / 未勾选">
        <option value="true">已勾选</option>
        <option value="false">未勾选</option>
      </select>
    );
  }

  if (def.valueKind === 'select' || def.valueKind === 'multiSelect') {
    const options = field?.options ?? [];
    const current = String(value ?? '');
    return (
      <select value={current} onChange={(e) => onChange(e.target.value)} title="选择要比较的选项">
        {current === '' && <option value="">（请选择）</option>}
        {current !== '' && !options.includes(current) && <option value={current}>{current}（未定义）</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (def.valueKind === 'date') {
    return (
      <input
        type="date"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
    );
  }

  if (def.valueKind === 'number') {
    return (
      <input
        className="cond-input narrow"
        inputMode="decimal"
        placeholder="数字"
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => {
          const text = e.target.value;
          if (text === '') return onChange(null);
          const parsed = Number(text);
          onChange(Number.isFinite(parsed) ? parsed : text);
        }}
      />
    );
  }

  return (
    <input
      className="cond-input"
      placeholder="值"
      value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
    />
  );
}

export function FilterBar({
  view,
  fields,
  fieldMap,
  onFilterChange,
}: {
  view: ViewConfig;
  fields: ResolvedField[];
  fieldMap: Map<string, ResolvedField>;
  onFilterChange: (viewId: string, filter: ViewFilter) => void;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const filter: ViewFilter = view.filter ?? { logic: 'and', conditions: [] };
  // 注意：这里必须通过 onFilterChange 让界面自己先更新，宿主机只负责持久化（不回传数据）
  const setFilter = (next: ViewFilter) => onFilterChange(view.id, next);
  const filterable = fields.filter((f) => !f.complex);

  const update = (id: string, patch: Partial<FilterCondition>) =>
    setFilter({ ...filter, conditions: filter.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  const remove = (id: string) => setFilter({ ...filter, conditions: filter.conditions.filter((c) => c.id !== id) });

  return (
    <div className="filterbar">
      <span className="filter-label">筛选</span>

      {filter.conditions.map((condition) => {
        const field = fieldFor(condition.key, fieldMap);
        const def = operatorDef(field, condition.operator);
        return (
          <span className={`cond${field ? '' : ' invalid'}`} key={condition.id} title={describeCondition(field, condition)}>
            <span className="cond-field">{field ? field.label : `${condition.key}（字段已不存在）`}</span>
            <select
              value={condition.operator}
              onChange={(e) => {
                const operator = e.target.value as FilterCondition['operator'];
                const nextDef = operatorDef(field, operator);
                update(condition.id, {
                  operator,
                  value: nextDef.needsValue ? (nextDef.valueKind === 'checkbox' ? true : null) : null,
                });
              }}
            >
              {operatorsFor(field).map((item) => (
                <option key={item.op} value={item.op}>
                  {item.label}
                </option>
              ))}
            </select>
            <ValueEditor
              field={field}
              def={def}
              value={condition.value}
              onChange={(value) => update(condition.id, { value })}
            />
            <button className="cond-remove" title="移除这个条件" onClick={() => remove(condition.id)}>
              ×
            </button>
          </span>
        );
      })}

      {filter.conditions.length >= 2 && (
        <select
          value={filter.logic}
          title="多个条件之间的关系"
          onChange={(e) => setFilter({ ...filter, logic: e.target.value === 'or' ? 'or' : 'and' })}
        >
          <option value="and">全部满足</option>
          <option value="or">任一满足</option>
        </select>
      )}

      <span style={{ position: 'relative', display: 'inline-block' }}>
        <button onClick={() => setAdding((v) => !v)} title="添加一个筛选条件">
          ＋ 添加条件
        </button>
        {adding && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setAdding(false)} />
            <div className="panel" style={{ top: '100%', left: 0, maxHeight: 320, overflow: 'auto', minWidth: 260 }}>
              {filterable.length === 0 && <div className="popup-empty">没有可筛选的字段</div>}
              {filterable.map((field) => (
                <div
                  key={field.key}
                  className="row-item"
                  onClick={() => {
                    setFilter({ ...filter, conditions: [...filter.conditions, defaultCondition(field, newConditionId())] });
                    setAdding(false);
                  }}
                >
                  <span>{field.label}</span>
                  <span className="key">{field.key}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </span>

      {!isEmptyFilter(filter) && (
        <button onClick={() => setFilter({ logic: filter.logic, conditions: [] })} title="清空所有筛选条件">
          清除
        </button>
      )}
    </div>
  );
}
