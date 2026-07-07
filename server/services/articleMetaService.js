'use strict';

/**
 * 文章元数据提取（refactor-design §5）。
 * 后端只做提取，不做 Markdown 渲染。
 *
 * Markdown 优先级：
 *   title    frontmatter.title -> 第一个 # h1 -> 文件名(去扩展名)
 *   date     frontmatter.date -> 文件名日期 -> (由 scanner 用 mtime 兜底)
 *   summary  frontmatter.summary -> ''
 *   category frontmatter.category -> (由 scanner 用叶子目录名兜底)
 *
 * HTML 优先级：
 *   title    meta[name=title] -> <title> -> 第一个 <h1> -> 文件名(去扩展名)
 *   date     meta[name=date] -> 文件名日期 -> (mtime 兜底)
 *   summary  meta[name=summary] -> meta[name=description] -> ''
 *   category meta[name=category] -> (叶子目录名兜底)
 */

const DATE_IN_FILENAME = /^(\d{4})-(\d{2})-(\d{2})/;

/** 解析极简 YAML frontmatter，支持标量与 `key:\n  - item` 列表。 */
function parseSimpleYaml(text) {
  const out = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    let val = m[2].trim();
    if (val === '') {
      // 可能是列表
      const list = [];
      let j = i + 1;
      while (j < lines.length) {
        const lm = lines[j].match(/^\s+-\s+(.*)$/);
        if (!lm) break;
        list.push(lm[1].trim());
        j++;
      }
      if (list.length) { out[key] = list; i = j; continue; }
      out[key] = '';
      i++;
    } else {
      // 去掉两端引号
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[key] = val;
      i++;
    }
  }
  return out;
}

/** 拆分 Markdown frontmatter 与正文，返回 { frontmatter, body, raw } */
function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: {}, body: text };
  return { frontmatter: parseSimpleYaml(m[1]), body: text.slice(m[0].length) };
}

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function firstH1FromMarkdown(body) {
  const m = body.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : '';
}

function filenameDate(name) {
  const m = name.match(DATE_IN_FILENAME);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function baseName(name) {
  return name.replace(/\.(md|markdown|html)$/i, '');
}

/**
 * 提取 Markdown 元数据。
 * @param {string} text 原文
 * @param {string} fileName 文件名（含扩展名）
 */
function extractMarkdownMeta(text, fileName) {
  const { frontmatter, body } = splitFrontmatter(text);
  const title =
    frontmatter.title ||
    firstH1FromMarkdown(body) ||
    baseName(fileName);
  const date = frontmatter.date || filenameDate(fileName) || '';
  const summary = frontmatter.summary || '';
  const category = frontmatter.category || '';
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
  return { title, date, summary, category, tags };
}

/**
 * 提取 HTML 元数据（不依赖 DOM，使用正则，足够覆盖本站 meta 写法）。
 * @param {string} html 原文
 * @param {string} fileName 文件名
 */
function extractHtmlMeta(html, fileName) {
  const meta = (name) => {
    const re = new RegExp(
      `<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']*)["']`,
      'i'
    );
    const m = html.match(re);
    if (m) return decodeEntities(m[1]);
    // 也兼容 content 在 name 之前的写法
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*name=["']${name}["']`,
      'i'
    );
    const m2 = html.match(re2);
    return m2 ? decodeEntities(m2[1]) : '';
  };

  const metaTitle = meta('title');
  const titleTag = (() => {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m ? m[1].trim() : '';
  })();
  const firstH1 = (() => {
    const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (!m) return '';
    return m[1].replace(/<[^>]+>/g, '').trim();
  })();

  const title = metaTitle || titleTag || firstH1 || baseName(fileName);
  const date = meta('date') || filenameDate(fileName) || '';
  const summary = meta('summary') || meta('description') || '';
  const category = meta('category') || '';
  return { title, date, summary, category, tags: [] };
}

module.exports = {
  splitFrontmatter,
  extractMarkdownMeta,
  extractHtmlMeta,
  baseName,
  filenameDate,
};
