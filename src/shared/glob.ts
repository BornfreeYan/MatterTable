/**
 * 忽略清单（exclude glob）匹配。
 *
 * 支持写法：
 *   `**\/node_modules/**`  任意层级的该目录及其内容
 *   `**\/*.md`             任意层级的 .md 文件
 *   `5 Projects/**`        根目录下的该目录及其内容
 *   `**\/.trash`           只匹配目录本身（其内容也会被排除，见下）
 *
 * 匹配时会同时测试路径的所有祖先前缀，所以「排除某个目录」会连带排除它的内容，
 * 这与 .gitignore 的直觉一致。
 */

function globToRegExp(pattern: string): RegExp {
  let p = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        if (p[i + 2] === '/') {
          re += '(?:.*/)?'; // **/ → 任意层级（可为零层）
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '/') {
      if (p.slice(i + 1) === '**') {
        re += '(?:/.*)?'; // 结尾的 /** 允许匹配目录自身
        break;
      }
      re += '/';
    } else {
      re += /[.*+?^${}()|[\]\\]/.test(c) ? '\\' + c : c;
    }
  }
  return new RegExp('^' + re + '$', 'i');
}

export function createMatcher(patterns: readonly string[]): (relPath: string) => boolean {
  const regexps = patterns.filter((p) => p && p.trim() !== '').map(globToRegExp);
  if (regexps.length === 0) return () => false;
  return (relPath: string) => {
    const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (normalized === '') return false;
    const parts = normalized.split('/');
    let prefix = '';
    for (let i = 0; i < parts.length; i++) {
      prefix = i === 0 ? parts[0] : prefix + '/' + parts[i];
      for (const re of regexps) {
        if (re.test(prefix)) return true;
      }
    }
    return false;
  };
}

export function matchesAny(relPath: string, patterns: readonly string[]): boolean {
  return createMatcher(patterns)(relPath);
}
