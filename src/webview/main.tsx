import { createRoot } from 'react-dom/client';
import type { WebviewToHost } from '../shared/types';
import { App } from './App';
import { styles } from './styles';

interface VsCodeApi {
  postMessage(message: WebviewToHost): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

const container = document.getElementById('root');
if (container) {
  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);
  createRoot(container).render(<App post={(message) => vscode.postMessage(message)} />);
}
