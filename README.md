# MatterTable

把 Markdown 的 front matter 显示成一张**可编辑的多维表格**，纯本地运行、不联网、不需要任何云端服务（不用 Notion、不用飞书多维表格）。

- 一行 = 一个 markdown 文件，一列 = front matter 里的一个字段
- 单元格可以直接改（文本 / 数字 / 复选框 / 日期 / 单选 / 多选），改完自动写回文件，**不用打开文档**
- 写回是「行级最小改写」：只替换目标字段那一段字节，换行符（CRLF/LF）、BOM、引号风格、块状列表、注释全部原样保留
- 文件名列只读，点击在新标签页打开该文件
- 支持列显隐、列顺序拖动、列宽拖动、单击列头排序（日期 / 文本 / 单选按选项顺序 / 数字 / 复选框）
- **多视图**：一个视图 = 一套扫描范围 + 筛选条件 + 列配置 + 排序；可新建 / 复制 / 重命名 / 删除，例如「CS 笔记」「Agent 开发」各一个视图
- **筛选**：等于、不等于、包含、不包含、大于、小于、为空、不为空，多个条件用「全部满足 / 任一满足」组合；筛选只在前端做，改条件与切视图都不会重新扫描
- **日历视图**：把有日期的笔记铺到月历上，点卡片打开文件、**拖到另一天直接改日期**；日期字段可选（不硬编码 `date`），同样支持筛选

## 安装（Cursor）

Cursor 读的是 Open VSX / 本地 vsix，本扩展目前以 `.vsix` 形式本地安装：

```bash
# 命令行安装（把路径换成实际的 vsix 文件）
cursor --install-extension "D:\KnowledgeBase\5 Projects\MatterTable\release\mattertable-0.3.1.vsix"
```

也可以图形界面：Cursor 里按 `Ctrl+Shift+P` → `Extensions: Install from VSIX...` → 选中该 `.vsix`。
安装后重载窗口（`Ctrl+Shift+P` → `Developer: Reload Window`）。

## 使用

1. 用 Cursor 打开你的知识库目录（或者打开任意目录，再用配置里的 `scope.root` 指向知识库）。
2. `Ctrl+Shift+P` → 输入 `MatterTable: 打开表格`。
3. 第一次打开会在工作区根目录创建 `.mattertable/config.json`，里面是字段类型、选项池、忽略清单等配置。

### 视图与筛选

**视图**放在工具栏最左侧的「视图：xxx ▾」里。一个视图就是一套独立的「扫描范围 + 筛选条件 + 列显隐/顺序/宽度 + 默认排序」，例如：

- 「全部笔记」：扫整个库，不筛选
- 「CS 笔记」：只要 `categories 等于 CS` 且 `state 不等于 finished` 的（筛选条件栏里加）
- 「Agent 开发」：把扫描根目录设成 `D:\KnowledgeBase\3 Agent Dev`，只扫这个目录

视图菜单里可以新建、复制当前视图（含筛选与列设置）、重命名、设置扫描范围、删除。当前视图与所有视图配置都写在工作区的 `.mattertable/config.json` 里，跟着库走。

**筛选条件栏**在工具栏下方：`＋ 添加条件` 选字段 → 选操作符 → 填值；两个及以上条件时可选「全部满足 / 任一满足」。筛选完全在前端完成，**修改条件或切换视图都不会重新扫描磁盘**；切换视图只有在扫描范围不同时才会重扫（有缓存，通常几十毫秒）。

各字段类型可用的操作符：

| 字段类型 | 操作符 |
| --- | --- |
| 文本（含文件名） | 等于、不等于、包含、不包含、为空、不为空 |
| 数字 | 等于、不等于、大于、小于、为空、不为空 |
| 日期 | 等于、不等于、晚于、早于、为空、不为空 |
| 单选 | 等于、不等于、为空、不为空 |
| 多选 | 包含任一、不包含任何、为空、不为空 |
| 复选框 | 等于（已勾选/未勾选）、未设置 |

容错：条件引用的字段如果被删掉/改名了，**不会报错也不会误筛**，只是在条件上标注「字段已不存在」；条件还没填值时视为不生效。

### 日历视图

视图切换器里选「＋ 新建日历视图」即可。月历上只显示**日期字段不为空**的笔记：

- **日期字段可选**：视图配置里的 `dateField` 决定用哪个字段归类，不填就自动取第一个 `type: "date"` 的字段；日历顶部也有下拉可以随时切换
- **点卡片**在新标签页打开文件
- **把卡片拖到另一天**就是改日期——写回走的是和表格完全相同的通道，所以同样只改那一段字节、同样有冲突检测与撤销
- **翻月**用 `‹` / `›` / 「今天」
- 没有日期的笔记不会消失在沉默里：顶部显示「另有 N 项没有日期」
- 日历视图同样支持筛选条件

不做多日任务（`start` + `due` 跨天条）。

### 命令

| 命令 | 说明 |
| --- | --- |
| `MatterTable: 打开表格` | 在编辑器标签页打开表格 |
| `MatterTable: 刷新表格` | 重新扫描（文件变更也会自动刷新） |
| `MatterTable: 打开配置文件` | 打开 `.mattertable/config.json` |
| `MatterTable: 撤销上一次改动` | 撤销上一次表格写入（本次会话内有效） |

### 表格里的操作

| 操作 | 方式 |
| --- | --- |
| 编辑单元格 | 单击选中后按 `Enter` / `F2`，或再单击一次 |
| 移动选中 | 方向键；`Tab` / `Shift+Tab` 左右移动 |
| 清空单元格 | 选中后按 `Delete` / `Backspace` |
| 取消编辑 | `Esc` |
| 复选框 | 直接单击切换 |
| 排序 | 单击列头（升序 → 降序 → 取消） |
| 切换 / 管理视图 | 工具栏最左的「视图：xxx ▾」 |
| 添加筛选条件 | 工具栏下方「＋ 添加条件」 |
| 隐藏列 | 列头右键，或工具栏「字段」面板 |
| 调列宽 | 拖动列头右边缘 |
| 调整列顺序 | 按住列头左右拖动（「文件名」列固定在最左，不可拖动） |
| 打开文件 | 点击文件名（在新标签页打开） |
| 补 front matter | 打开「显示无 front matter 的文件」，在行首点「补骨架」 |

## 配置说明（`.mattertable/config.json`）

```jsonc
{
  "scope": {
    // 不填 = 用当前工作区根目录；也可以写绝对路径
    "root": "D:/KnowledgeBase",
    "include": ["**/*.md"],
    // 忽略清单，支持 **/ 与 * 通配；排除某个目录会连带排除其内容
    "exclude": ["**/node_modules/**", "**/20 Raw/**", "5 Projects/**"]
  },
  "settings": {
    // 清空单元格时怎么写回：null（保留 key 写空）| remove（删掉整个 key）| emptyString（写成 ""）
    "emptyValueStyle": "null",
    "showFilesWithoutFrontmatter": false
  },
  "fields": [
    { "key": "title", "type": "text", "label": "标题", "width": 260, "visible": true, "order": 1 },
    { "key": "date", "type": "date", "label": "日期", "width": 130, "order": 2 },
    {
      "key": "state", "type": "select", "storage": "list", "label": "状态",
      // options 为空数组 = 自动模式：选项池由扫描结果收集
      // options 手写 = 固定模式：顺序即排序顺序，未在列表里的值显示为「未定义」
      "options": ["not started", "finished"], "width": 130, "order": 5
    }
  ],
  "skeleton": {
    // 「补骨架」时按这个顺序生成字段，date 自动填今天
    "fields": ["title", "date", "categories", "tags", "state"],
    "autoFillDateToday": true,
    "stateDefault": ["not started"]
  },
  "views": [
    {
      "id": "default",
      "name": "全部笔记",
      "type": "table",
      "filter": { "logic": "and", "conditions": [] },
      "sort": [],
      // 列显隐的权威来源（字段的 visible 只作为首次生成的初值）
      "hiddenColumns": ["description"],
      "columnWidths": {}
    },
    {
      "id": "view-cs",
      "name": "CS 笔记",
      // 视图级扫描范围：不填则用全局 scope；exclude 会与全局的取并集（只能多忽略，不能少忽略）
      "scope": { "exclude": ["**/22 Leetcode/**"] },
      "filter": {
        "logic": "and",
        "conditions": [
          { "id": "c1", "key": "categories", "operator": "equals", "value": "CS" },
          { "id": "c2", "key": "state", "operator": "notEquals", "value": "finished" }
        ]
      },
      "sort": [{ "key": "date", "direction": "desc" }],
      "hiddenColumns": ["description"]
    },
    {
      "id": "view-calendar",
      "name": "发布日历",
      // 日历视图：用哪个字段归类；不填 = 自动取第一个 type 为 date 的字段
      "type": "calendar",
      "dateField": "date",
      "filter": { "logic": "and", "conditions": [] }
    }
  ],
  // 当前激活的视图（跟库走）
  "activeViewId": "default"
}
```

### 字段类型

| type | 说明 | 写法 |
| --- | --- | --- |
| `text` | 文本 | `title: xxx`（含 `: `、`#`、`true`、纯数字等内容时自动加引号） |
| `number` | 数字 | `priority: 3` |
| `checkbox` | 复选框 | `published: true` |
| `date` | 日期 | `date: 2026-09-13`（统一写不带引号的 ISO 日期） |
| `select` | 单选 | 默认写单项列表 `state:\n  - finished`；`storage: "scalar"` 则写 `state: finished` |
| `multiSelect` | 多选 | `tags:\n  - a\n  - b` |

配置里没声明的字段也会自动出现（类型按值推断，列头显示为浅色），可在配置里补上类型声明。

## 数据安全

- 只改写目标字段那一段字节，其他内容逐字节不变（有 62 个单元测试 + 全库审计脚本兜底）。
- 写入前会校验文件是否被外部修改过（修改时间 + 大小），文件在编辑器里未保存时拒绝写入。
- front matter 不是合法 YAML 的文件整行只读，写入被拒绝并给出错误位置。
- 嵌套结构字段（值是对象或对象列表，如 VitePress 的 `hero` / `sitemap`）只读，默认隐藏。
- 每次写入都会在内存里留一份原文，可用「撤销上一次改动」回退（本次会话有效）。

## 开发

```bash
pnpm install            # 安装依赖（pnpm 11 的构建脚本放行写在 pnpm-workspace.yaml 里）
pnpm typecheck          # 类型检查
pnpm test               # 单元测试 + 界面组件测试（写入器 / 排序 / 忽略清单 / 筛选引擎 / React 组件，共 152 项）
pnpm build              # 打包扩展宿主与界面到 dist/
pnpm watch              # 开发模式（改动即重建）
pnpm smoke              # 集成冒烟测试：桩替换 vscode API 跑「扫描→写入→撤销→冲突」全流程
pnpm verify             # 一次跑完：类型检查 + 单测 + 构建 + 冒烟测试（打包前请先跑这个）
pnpm vsix               # 打出 release/mattertable-x.y.z.vsix
pnpm fixtures "D:\某目录\demo"   # 生成覆盖各种边界写法的测试用 markdown（加 --count 500 顺便生成规模测试数据）
```

真实数据审计（验证字节保真度，不会修改任何文件）：

```bash
pnpm audit "D:/KnowledgeBase"
```

目录结构：`src/extension/` 扩展宿主、`src/webview/` 表格界面、`src/shared/` 两侧共用（无 vscode 依赖）、`test/` 单元测试、`docs/` 文档。

规划与需求见 `docs/MVP-PRD.md`（v1 表格与写入安全）、`docs/V2-PRD.md`（筛选与多视图的语义、验收标准），安装与验收步骤见 `docs/TEST-GUIDE.md`。
