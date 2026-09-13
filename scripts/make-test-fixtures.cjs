/**
 * 生成测试夹具：一个装满各种 front matter 写法的目录，用来手动验收 MatterTable。
 *
 * 用法：
 *   node scripts/make-test-fixtures.cjs "C:/Users/you/test-repo/demo"
 *   node scripts/make-test-fixtures.cjs "C:/Users/you/test-repo/demo" --count 800
 *
 * 生成的文件刻意覆盖了容易出问题的写法：CRLF、BOM、带引号日期、块状/flow 列表、
 * 空值、空列表项、非法 YAML、嵌套结构、块标量、数字、复选框。
 * 加 --count N 会额外生成 N 篇结构规整的笔记（放在 scale/ 下），用来测滚动、排序与列宽。
 */
const fs = require('node:fs/promises');
const path = require('node:path');

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--') && Number.isNaN(Number(a)));
const countIndex = args.indexOf('--count');
const count = countIndex >= 0 ? Number(args[countIndex + 1]) : Number(args.find((a) => !Number.isNaN(Number(a))) ?? 0);
if (!target) {
  console.error('用法：node scripts/make-test-fixtures.cjs <目标目录> [--count N]');
  process.exit(1);
}

const CRLF = '\r\n';
const BOM = '\ufeff';
const LF = '\n';

/** 每项：文件名 + 内容 + 这个文件想验证什么 */
const files = [
  {
    name: '01-normal.md',
    note: '最普通的笔记：LF 换行、块状列表、带引号的日期、字段行注释',
    content: [
      '---',
      'title: Agent Concepts Introduction',
      "date: '2026-03-07'",
      'categories:',
      '  - AI',
      'tags:',
      '  - Agent',
      '  - 工程纪律',
      'state:',
      '  - not started',
      '---',
      '',
      '这是正文第一行。',
      '这是正文第二行。',
      '',
    ].join(LF),
  },
  {
    name: '02-crlf-bom.md',
    note: 'CRLF 换行 + BOM 开头：改字段后换行符与 BOM 都必须原样保留',
    content:
      BOM +
      ['---', 'title: Python 基础', 'date: 2026-09-06', 'categories:', '  - CS', 'state:', '  - finished', '---', '', 'CRLF 与 BOM 测试正文。', ''].join(
        CRLF,
      ),
  },
  {
    name: '03-empty-values.md',
    note: '各种空值写法：空字符串日期、空列表项、只有 key 没有值',
    content: [
      '---',
      'title: 空值测试',
      'date: ""',
      'categories:',
      '  - ',
      'tags:',
      'state:',
      '  - not started',
      'description:',
      '---',
      '',
      '空值测试正文。',
      '',
    ].join(LF),
  },
  {
    name: '04-all-types.md',
    note: '数字、复选框、flow 风格列表、块标量（多行文本）',
    content: [
      '---',
      'title: 各种类型测试',
      'date: 2026-09-13',
      'priority: 3',
      'published: true',
      'tags: [CS, AI]',
      'description: |-',
      '  这是一段多行文本，',
      '  用块标量写法存放。',
      'state:',
      '  - not started',
      '---',
      '',
      '正文。',
      '',
    ].join(LF),
  },
  {
    name: '05-no-frontmatter.md',
    note: '没有 front matter：默认隐藏，打开「显示无 front matter 的文件」后可以点「补骨架」',
    content: ['# 没有前置信息的笔记', '', '正文内容。', ''].join(LF),
  },
  {
    name: '06-invalid-yaml.md',
    note: 'front matter 是非法 YAML（值里冒号没转义）：整行只读，写入必须被拒绝',
    content: ['---', 'title: 发现问题: 你好', '---', '', '非法 YAML 测试正文。', ''].join(LF),
  },
  {
    name: '07-nested.md',
    note: '嵌套结构（hero / sitemap / 对象列表）：这些字段只读，默认隐藏',
    content: [
      '---',
      'title: 嵌套结构测试',
      'date: 2026-09-13',
      'hero:',
      '  name: Vibe Vibe',
      '  text: 人人都能 AI 创造',
      'sitemap:',
      '  changefreq: weekly',
      '  priority: 0.9',
      'features:',
      '  - title: 零基础友好',
      '    details: 不需要任何编程经验',
      '  - title: 快速上手',
      '    details: 从一个想法开始',
      'state:',
      '  - not started',
      '---',
      '',
      '嵌套结构测试正文。',
      '',
    ].join(LF),
  },
];

async function main() {
  const root = path.resolve(target);
  await fs.mkdir(root, { recursive: true });
  const lines = ['', '生成的测试文件：', ''];
  for (const file of files) {
    await fs.writeFile(path.join(root, file.name), file.content, 'utf8');
    lines.push(`  ${file.name}`);
    lines.push(`      ${file.note}`);
  }

  if (count > 0) {
    const scaleDir = path.join(root, 'scale');
    await fs.mkdir(scaleDir, { recursive: true });
    const categories = ['CS', 'AI', 'English', 'Life'];
    const states = ['not started', 'in progress', 'finished'];
    for (let i = 1; i <= count; i++) {
      const id = String(i).padStart(4, '0');
      const month = String((i % 12) + 1).padStart(2, '0');
      const day = String((i % 28) + 1).padStart(2, '0');
      // 每 17 篇留一个没有 front matter 的，用来验证「隐藏无前置信息」的计数
      const content =
        i % 17 === 0
          ? `# 规模测试笔记 ${id}\n\n这篇没有 front matter。\n`
          : [
              '---',
              `title: 规模测试笔记 ${id}`,
              `date: 2026-${month}-${day}`,
              'categories:',
              `  - ${categories[i % categories.length]}`,
              'tags:',
              '  - 规模测试',
              `  - tag-${i % 7}`,
              'state:',
              `  - ${states[i % states.length]}`,
              `priority: ${i % 5}`,
              '---',
              '',
              `第 ${i} 篇，用来测滚动、排序与列宽。`,
              '',
            ].join('\n');
      await fs.writeFile(path.join(scaleDir, `note-${id}.md`), content, 'utf8');
    }
    lines.push(`  scale/note-0001.md … note-${String(count).padStart(4, '0')}.md`);
    lines.push(`      ${count} 篇结构规整的笔记，用来测滚动（虚拟滚动）、排序、列宽与性能`);
  }

  console.log(`已生成测试文件到：${root}`);
  console.log(lines.join('\n'));
  console.log('');
  console.log('接下来：');
  console.log('  1. 用 Cursor 打开这个目录（或它的上级目录）');
  console.log('  2. Ctrl+Shift+P → MatterTable: 打开表格');
  console.log('  3. 按 docs/TEST-GUIDE.md 的清单逐项验收');
}

void main();
