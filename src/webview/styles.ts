export const styles = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; padding: 0; }
/* 让原生控件（尤其是 select 的下拉列表）跟随编辑器主题，否则深色主题下会出现白底白字 */
body.vscode-dark, body.vscode-high-contrast { color-scheme: dark; }
body.vscode-light { color-scheme: light; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}
.app { display: flex; flex-direction: column; height: 100%; }
.toolbar {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px;
  border-bottom: 1px solid var(--vscode-panel-border); flex: none; flex-wrap: wrap;
}
.toolbar .spacer { flex: 1; }
.toolbar button {
  background: var(--vscode-button-secondaryBackground, transparent);
  color: var(--vscode-button-secondaryForeground, inherit);
  border: 1px solid var(--vscode-panel-border); border-radius: 3px;
  padding: 2px 8px; cursor: pointer; font: inherit;
}
.toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,.15)); }
.toolbar button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
.toolbar input[type="search"], .toolbar input.search {
  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 3px; padding: 2px 6px; font: inherit; width: 200px;
}
.stats { color: var(--vscode-descriptionForeground); font-size: 12px; }
label.toggle { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; font-size: 12px; }

.toasts {
  position: fixed; right: 14px; bottom: 14px; z-index: 2000;
  display: flex; flex-direction: column; gap: 6px; max-width: 380px;
  pointer-events: none;
}
.toast {
  pointer-events: auto; display: flex; align-items: flex-start; gap: 6px;
  padding: 6px 10px; border-radius: 6px; font-size: 12px; line-height: 1.55;
  background: var(--vscode-notifications-background, var(--vscode-editorWidget-background, #252526));
  color: var(--vscode-notifications-foreground, var(--vscode-foreground));
  border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
  border-left-width: 3px;
  box-shadow: 0 4px 14px rgba(0,0,0,.35);
  animation: toast-in .16s ease-out;
}
.toast.info { border-left-color: var(--vscode-notificationsInfoIcon-foreground, #3794ff); }
.toast.warn { border-left-color: var(--vscode-notificationsWarningIcon-foreground, #cca700); }
.toast.error { border-left-color: var(--vscode-notificationsErrorIcon-foreground, #f14c4c); }
.toast .icon { opacity: .9; }
.toast .msg { flex: 1; white-space: pre-wrap; word-break: break-word; }
.toast button {
  background: none; border: none; color: inherit; cursor: pointer; opacity: .55; padding: 0 2px; font-size: 13px;
}
.toast button:hover { opacity: 1; }
@keyframes toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.filterbar {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: none;
  padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border);
  background: rgba(128,128,128,.06); font-size: 12px;
}
.filterbar .filter-label { color: var(--vscode-descriptionForeground); }
.filterbar select, .filterbar input {
  background: var(--vscode-dropdown-background, var(--vscode-input-background));
  color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
  border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, var(--vscode-panel-border)));
  border-radius: 3px; padding: 1px 4px; font: inherit; max-width: 200px;
}
/* 下拉展开后的选项列表由浏览器绘制，必须显式给颜色，否则深色主题下是白底白字 */
.filterbar select option, .inline-form select option, .panel select option {
  background: var(--vscode-dropdown-background, var(--vscode-input-background));
  color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
}
.filterbar .cond {
  display: inline-flex; align-items: center; gap: 4px;
  border: 1px solid var(--vscode-panel-border); border-radius: 12px; padding: 1px 4px 1px 8px;
  background: var(--vscode-editor-background);
}
.filterbar .cond.invalid { border-style: dashed; border-color: var(--vscode-errorForeground); }
.filterbar .cond-field { color: var(--vscode-descriptionForeground); }
.filterbar .cond-input { width: 110px; }
.filterbar .cond-input.narrow { width: 64px; }
.filterbar .cond-remove {
  background: none; border: none; color: inherit; cursor: pointer; opacity: .6; padding: 0 2px; font-size: 13px;
}
.filterbar .cond-remove:hover { opacity: 1; }

.inline-form { display: flex; flex-direction: column; gap: 4px; }
.inline-form input, .inline-form textarea {
  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 3px; padding: 3px 6px; font: inherit; width: 100%;
}
.inline-form .inline-actions { display: flex; gap: 6px; margin-top: 4px; }
.inline-form .inline-actions button {
  background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, inherit);
  border: 1px solid var(--vscode-panel-border); border-radius: 3px; padding: 3px 10px; cursor: pointer; font: inherit;
}
.inline-form .inline-actions button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }

.grid { flex: 1; overflow: auto; position: relative; outline: none; }
.grid-content { position: relative; }
.header-row {
  display: flex; position: sticky; top: 0; z-index: 3; height: 30px;
  background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border);
}
.th {
  position: relative; display: flex; align-items: center; padding: 0 6px; flex: none;
  font-weight: 600; border-right: 1px solid var(--vscode-panel-border);
  cursor: pointer; user-select: none; overflow: hidden; white-space: nowrap;
}
.th.inferred { font-weight: 400; color: var(--vscode-descriptionForeground); }
.th:hover { background: rgba(128,128,128,.12); }
.th.dragging { opacity: .45; }
.th.drop-target { box-shadow: inset 2px 0 0 var(--vscode-focusBorder); }
.th .sort { margin-left: 4px; font-size: 10px; opacity: .9; }
.th .sizer { position: absolute; right: -3px; top: 0; bottom: 0; width: 6px; cursor: col-resize; z-index: 4; }
.th .sizer:hover { background: var(--vscode-focusBorder); }

.rows { position: relative; }
.row { display: flex; position: absolute; left: 0; border-bottom: 1px solid var(--vscode-panel-border); }
.row:nth-child(even) { background: rgba(128,128,128,.05); }
.row.selected-row { background: rgba(128,128,128,.12); }
.td {
  display: flex; align-items: center; padding: 0 6px; flex: none;
  border-right: 1px solid var(--vscode-panel-border);
  overflow: hidden; white-space: nowrap; cursor: cell;
}
.td > .value { overflow: hidden; text-overflow: ellipsis; }
.td.cell-selected { outline: 2px solid var(--vscode-focusBorder); outline-offset: -2px; }
.td.centered { justify-content: center; }
.td.complex { color: var(--vscode-descriptionForeground); font-style: italic; }
.file-cell { color: var(--vscode-textLink-foreground); }
.file-cell:hover { text-decoration: underline; }
.file-wrap { display: flex; align-items: center; gap: 6px; overflow: hidden; width: 100%; }
.file-name { overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.skeleton-btn {
  flex: none; font-size: 11px; padding: 0 6px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--vscode-panel-border); background: var(--vscode-button-secondaryBackground, transparent);
  color: var(--vscode-button-secondaryForeground, inherit);
}
.skeleton-btn:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,.2)); }
.row-error { color: var(--vscode-errorForeground); }

.chip {
  display: inline-block; padding: 0 6px; margin-right: 4px; border-radius: 9px;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  font-size: 11px; line-height: 17px; max-width: 160px; overflow: hidden; text-overflow: ellipsis;
}
.chip.undef { background: transparent; border: 1px dashed var(--vscode-descriptionForeground); color: var(--vscode-descriptionForeground); }
.chip.empty { background: transparent; color: var(--vscode-descriptionForeground); border: none; }
.check { font-size: 14px; }
.editor-input {
  width: 100%; height: 100%; border: none; outline: none; font: inherit;
  background: var(--vscode-input-background); color: var(--vscode-input-foreground); padding: 0 4px;
}
.editor-input.invalid { outline: 1px solid var(--vscode-inputValidation-errorBorder, #f14c4c); }

.popup {
  z-index: 1000; display: flex; flex-direction: column; max-height: 280px;
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
  box-shadow: 0 2px 10px rgba(0,0,0,.4); border-radius: 4px; overflow: hidden;
}
.popup-search {
  border: none; outline: none; padding: 5px 8px; font: inherit;
  background: transparent; color: inherit; border-bottom: 1px solid var(--vscode-panel-border);
}
.popup-list { overflow: auto; }
.popup-item { padding: 3px 8px; cursor: pointer; white-space: nowrap; display: flex; gap: 6px; align-items: center; }
.popup-item.hl, .popup-item:hover { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.popup-item .hint { font-size: 11px; opacity: .7; }
.popup-item.create { color: var(--vscode-textLink-foreground); }
.popup-item.clear { color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-panel-border); }
.popup-empty { padding: 6px 8px; color: var(--vscode-descriptionForeground); }
.chips { display: flex; flex-wrap: wrap; gap: 3px; padding: 4px; max-height: 120px; overflow: auto; }
.chip-edit { display: inline-flex; align-items: center; gap: 3px; }
.chip-edit button { background: none; border: none; color: inherit; cursor: pointer; padding: 0 1px; opacity: .7; }
.panel {
  position: absolute; z-index: 1000; padding: 6px; min-width: 220px; max-height: 340px; overflow: auto;
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
  box-shadow: 0 2px 10px rgba(0,0,0,.4); border-radius: 4px;
}
.panel .row-item { display: flex; align-items: center; gap: 6px; padding: 3px 4px; cursor: pointer; }
.panel .row-item:hover { background: rgba(128,128,128,.15); }
.panel .row-item.current { font-weight: 600; }
.panel .row-item .mark { width: 12px; opacity: .8; }
.panel .row-item.disabled { cursor: default; color: var(--vscode-descriptionForeground); }
.panel .row-item.disabled:hover { background: none; }
.panel .key { color: var(--vscode-descriptionForeground); font-size: 11px; }
.panel hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 6px 0; }
.empty-state { padding: 24px; color: var(--vscode-descriptionForeground); }

/* ------------------------------------------------------------------ 日历视图 */
.calendar { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 8px 10px 10px; }
.cal-toolbar { flex: none; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-bottom: 8px; }
.cal-toolbar button {
  background: var(--vscode-button-secondaryBackground, transparent);
  color: var(--vscode-button-secondaryForeground, inherit);
  border: 1px solid var(--vscode-panel-border); border-radius: 3px;
  padding: 1px 8px; cursor: pointer; font: inherit;
}
.cal-toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,.15)); }
.cal-month { font-weight: 600; font-size: 14px; }
.cal-hint { color: var(--vscode-descriptionForeground); font-size: 12px; }
.cal-field { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--vscode-descriptionForeground); }
.cal-field select {
  background: var(--vscode-dropdown-background, var(--vscode-input-background));
  color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
  border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, var(--vscode-panel-border)));
  border-radius: 3px; padding: 1px 4px; font: inherit;
}
.cal-field select option {
  background: var(--vscode-dropdown-background, var(--vscode-input-background));
  color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
}
.cal-warn {
  flex: none; margin-bottom: 6px; padding: 5px 8px; font-size: 12px; border-radius: 4px;
  background: var(--vscode-inputValidation-warningBackground, rgba(255,200,0,.12));
  border-left: 3px solid var(--vscode-inputValidation-warningBorder, #cca700);
}
.cal-weekdays {
  flex: none; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr));
  font-size: 12px; color: var(--vscode-descriptionForeground);
  border-bottom: 1px solid var(--vscode-panel-border);
}
.cal-weekdays > div { padding: 4px 6px; text-align: center; }
.cal-weekdays > div.weekend { opacity: .75; }
.cal-grid {
  flex: 1; min-height: 0; display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  grid-template-rows: repeat(6, minmax(0, 1fr));
  gap: 1px; background: var(--vscode-panel-border);
  border: 1px solid var(--vscode-panel-border); border-top: none;
}
.cal-day {
  background: var(--vscode-editor-background); padding: 3px 4px;
  display: flex; flex-direction: column; gap: 2px; min-height: 0; overflow: hidden;
}
.cal-day.out { background: rgba(128,128,128,.07); }
.cal-day.out .cal-daynum { opacity: .45; }
.cal-day.today { box-shadow: inset 0 0 0 2px var(--vscode-focusBorder); }
.cal-day.drop { background: rgba(128,128,128,.28); outline: 2px dashed var(--vscode-focusBorder); outline-offset: -2px; }
.cal-daynum { flex: none; font-size: 11px; color: var(--vscode-descriptionForeground); text-align: right; }
.cal-items { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
.cal-item {
  flex: none; font-size: 12px; padding: 1px 5px; border-radius: 3px; cursor: pointer;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cal-item:hover { filter: brightness(1.18); }
.cal-item.dragging { opacity: .4; }
`
