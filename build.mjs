import esbuild from 'esbuild';
import { rm, mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

/** 扩展宿主（Node 环境，vscode 由宿主提供） */
const hostConfig = {
  entryPoints: ['src/extension/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  bundle: true,
  charset: 'utf8',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
};

/** 界面（浏览器环境，打包成一个自包含的 bundle，由面板注入 HTML） */
const webviewConfig = {
  entryPoints: ['src/webview/main.tsx'],
  outfile: 'dist/webview.js',
  platform: 'browser',
  format: 'iife',
  target: 'chrome110',
  bundle: true,
  jsx: 'automatic',
  charset: 'utf8',
  define: { 'process.env.NODE_ENV': '"production"' },
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
};

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

if (watch) {
  for (const cfg of [hostConfig, webviewConfig]) {
    const ctx = await esbuild.context(cfg);
    await ctx.watch();
  }
  console.log('[build] watching for changes...');
} else {
  await Promise.all([esbuild.build(hostConfig), esbuild.build(webviewConfig)]);
  console.log('[build] done');
}
