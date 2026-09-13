import * as vscode from 'vscode';
import { TableController } from './controller';

let controller: TableController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  controller = new TableController(context);
  context.subscriptions.push(controller);
  context.subscriptions.push(
    vscode.commands.registerCommand('mattertable.openTable', () => controller?.open()),
    vscode.commands.registerCommand('mattertable.refresh', () => controller?.refresh()),
    vscode.commands.registerCommand('mattertable.openConfig', () => controller?.openConfigCommand()),
    vscode.commands.registerCommand('mattertable.undoLastWrite', () => controller?.undoLastWrite()),
    vscode.commands.registerCommand('mattertable.showLog', () => controller?.showLog()),
  );
}

export function deactivate(): void {
  controller?.dispose();
  controller = undefined;
}
