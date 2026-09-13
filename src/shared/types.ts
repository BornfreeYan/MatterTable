/** 字段类型（MVP 支持的 6 种，配置里可写的就是这些） */
export type FieldType = 'text' | 'number' | 'checkbox' | 'date' | 'select' | 'multiSelect';

/** 单选字段的底层存储形态：list = 单项列表（你的库现有风格），scalar = 裸标量 */
export type SelectStorage = 'list' | 'scalar';

/** 清空单元格时怎么写回文件 */
export type EmptyValueStyle = 'null' | 'remove' | 'emptyString';

export type CellValue = string | number | boolean | string[] | null;

export type SortDirection = 'asc' | 'desc';

/** 文件名列：始终存在、只读、点击打开文件 */
export const FILE_COLUMN_KEY = '__file';

export interface FieldDef {
  key: string;
  type: FieldType;
  label?: string;
  storage?: SelectStorage;
  /** 空数组或省略 = 自动模式：选项池由扫描结果收集 */
  options?: string[];
  visible?: boolean;
  width?: number;
  order?: number;
}

export interface ResolvedField {
  key: string;
  type: FieldType;
  label: string;
  storage: SelectStorage;
  options: string[];
  /** true = 选项池来自自动扫描（配置里没写） */
  optionsAuto: boolean;
  visible: boolean;
  width: number;
  order: number;
  /** true = 值不是标量（嵌套对象/对象数组），只读 */
  complex: boolean;
  source: 'config' | 'inferred' | 'builtin';
}

export interface SortSpec {
  key: string;
  direction: SortDirection;
}

/** 筛选操作符（同一个操作符在不同字段类型上会显示成不同中文名，见 shared/filter.ts） */
export type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'gt'
  | 'lt'
  | 'isEmpty'
  | 'isNotEmpty';

export interface FilterCondition {
  /** 界面上增删条件用的稳定 id */
  id: string;
  /** 字段 key，也可以是文件名列 */
  key: string;
  operator: FilterOperator;
  value?: string | number | boolean | null;
}

export interface ViewFilter {
  logic: 'and' | 'or';
  conditions: FilterCondition[];
}

export type ViewType = 'table' | 'calendar';

export interface ViewConfig {
  id: string;
  name: string;
  type: ViewType;
  /** 日历视图用来归类的日期字段（不填 = 自动取第一个 date 类型字段；绝不硬编码 date） */
  dateField?: string;
  /** 视图级扫描范围：不填则用全局 scope；exclude 会与全局的取并集（只能加忽略，不能取消全局忽略） */
  scope?: ScopeConfig;
  filter?: ViewFilter;
  sort?: SortSpec[];
  hiddenColumns?: string[];
  columnOrder?: string[];
  columnWidths?: Record<string, number>;
}

export interface ScopeConfig {
  root?: string;
  include?: string[];
  exclude?: string[];
}

export interface SettingsConfig {
  emptyValueStyle?: EmptyValueStyle;
  dateFormat?: string;
  showFilesWithoutFrontmatter?: boolean;
}

export interface SkeletonConfig {
  fields?: string[];
  autoFillDateToday?: boolean;
  stateDefault?: string[];
}

export interface Config {
  version: number;
  scope: ScopeConfig;
  settings: SettingsConfig;
  fields: FieldDef[];
  skeleton: SkeletonConfig;
  views: ViewConfig[];
  /** 当前激活的视图 id */
  activeViewId?: string;
}

export interface RowData {
  /** 相对扫描根目录的路径，行唯一标识 */
  id: string;
  fileName: string;
  relPath: string;
  values: Record<string, CellValue>;
  hasFrontmatter: boolean;
  parseError?: string;
}

export interface TableStats {
  /** 扫描到并显示出来的文件数 */
  shown: number;
  /** front matter 是非法 YAML 的文件数 */
  unparsable: number;
  /** 没有 front matter、当前被隐藏的文件数 */
  withoutFrontmatter: number;
  /** 选项池是否被截断（候选值过多时） */
  optionsTruncated?: boolean;
}

export interface Notice {
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface InitMessage {
  type: 'init';
  fields: ResolvedField[];
  view: ViewConfig;
  /** 所有视图，供界面上的视图切换器使用 */
  views: ViewConfig[];
  rows: RowData[];
  stats: TableStats;
  chunkSize: number;
  showFilesWithoutFrontmatter: boolean;
  scopeRoot: string;
  configPath: string;
  emptyValueStyle: EmptyValueStyle;
  notices: Notice[];
}

export interface RowsChunkMessage {
  type: 'rowsChunk';
  offset: number;
  rows: RowData[];
}

export interface RowsUpdatedMessage {
  type: 'rowsUpdated';
  rows: RowData[];
  stats?: TableStats;
  removedIds?: string[];
}

export interface NoticeMessage {
  type: 'notice';
  notice: Notice;
}

export interface CellResultMessage {
  type: 'cellResult';
  id: string;
  key: string;
  value: CellValue;
  error?: string;
}

/** 字段定义变了（例如新增了选项），只更新字段，不动行数据与界面状态 */
export interface FieldsUpdatedMessage {
  type: 'fieldsUpdated';
  fields: ResolvedField[];
}

/** 视图配置变了（例如重置列宽），让界面重新套用布局 */
export interface ViewUpdatedMessage {
  type: 'viewUpdated';
  view: ViewConfig;
}

/** 视图配置变了（新增/重命名/删除/切换视图、筛选条件改动），不动行数据与界面状态 */
export interface ViewsUpdatedMessage {
  type: 'viewsUpdated';
  views: ViewConfig[];
  currentId: string;
}

export type HostToWebview =
  | InitMessage
  | RowsChunkMessage
  | RowsUpdatedMessage
  | NoticeMessage
  | CellResultMessage
  | FieldsUpdatedMessage
  | ViewUpdatedMessage
  | ViewsUpdatedMessage;

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'setCell'; id: string; key: string; value: CellValue }
  | { type: 'clearCell'; id: string; key: string }
  | { type: 'addOption'; key: string; value: string }
  | { type: 'openFile'; id: string }
  | { type: 'setSort'; key: string | null; direction: SortDirection }
  | { type: 'setColumnVisible'; key: string; visible: boolean }
  | { type: 'setColumnOrder'; order: string[] }
  | { type: 'setColumnWidth'; key: string; width: number }
  | { type: 'resetColumnWidths' }
  | { type: 'addSkeleton'; id: string }
  | { type: 'refresh' }
  | { type: 'openConfig' }
  | { type: 'toggleShowWithoutFrontmatter'; show: boolean }
  | { type: 'switchView'; viewId: string }
  | { type: 'createView'; name: string; copyCurrent: boolean; viewType?: ViewType }
  | { type: 'renameView'; viewId: string; name: string }
  | { type: 'duplicateView'; viewId: string }
  | { type: 'deleteView'; viewId: string }
  | { type: 'setViewFilter'; viewId: string; filter: ViewFilter }
  | { type: 'setViewDateField'; viewId: string; dateField: string }
  | { type: 'setViewScope'; viewId: string; scope: ScopeConfig };
