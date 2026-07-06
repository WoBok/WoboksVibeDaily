const fs = require('node:fs/promises');
const path = require('node:path');
const {
  articleFormat,
  displayName,
  titleFromFileName
} = require('../utils/pathTools');

function stripTags(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function extractDateFromFileName(fileName) {
  return path.basename(fileName).match(/(\d{4}-\d{2}-\d{2})/)?.[1] || '';
}

function parseFrontmatter(source) {
  const normalized = source.replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---')) {
    return { data: {}, body: normalized };
  }

  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: normalized };

  const data = {};
  let activeKey = '';
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (pair) {
      activeKey = pair[1];
      const raw = pair[2].trim();
      data[activeKey] = raw.replace(/^["']|["']$/g, '');
      continue;
    }

    const item = line.match(/^\s*-\s*(.+)$/);
    if (item && activeKey) {
      if (!Array.isArray(data[activeKey])) data[activeKey] = [];
      data[activeKey].push(item[1].trim().replace(/^["']|["']$/g, ''));
    }
  }

  return { data, body: normalized.slice(match[0].length) };
}

function parseMetaTags(html) {
  const result = {};
  const tags = html.match(/<meta\s+[^>]*>/gi) || [];

  for (const tag of tags) {
    const attrs = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) {
      attrs[match[1].toLowerCase()] = decodeEntities(match[3]);
    }

    const key = (attrs.name || attrs.property || '').toLowerCase();
    if (key && attrs.content) result[key] = attrs.content;
  }

  return result;
}

function parseHtmlMeta(source) {
  const meta = parseMetaTags(source);
  const title = decodeEntities(source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const h1 = stripTags(source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');

  return {
    title: meta.title || stripTags(title) || h1,
    date: meta.date || '',
    summary: meta.summary || meta.description || '',
    category: meta.category || ''
  };
}

async function readArticleMeta(absPath, relativePath, categoryPath) {
  const source = await fs.readFile(absPath, 'utf8');
  const stat = await fs.stat(absPath);
  const fileName = path.basename(absPath);
  const format = articleFormat(fileName);
  const categoryName = displayName(path.basename(categoryPath));
  let parsed = {};

  if (format === 'markdown') {
    const frontmatter = parseFrontmatter(source);
    const firstHeading = frontmatter.body.match(/^#\s+(.+)$/m)?.[1] || '';
    parsed = {
      title: frontmatter.data.title || firstHeading,
      date: frontmatter.data.date || '',
      summary: frontmatter.data.summary || '',
      category: frontmatter.data.category || ''
    };
  } else if (format === 'html') {
    parsed = parseHtmlMeta(source);
  }

  const date = parsed.date || extractDateFromFileName(fileName) || formatDate(stat.birthtime);

  return {
    id: relativePath,
    path: relativePath,
    name: fileName,
    format,
    title: parsed.title || titleFromFileName(fileName),
    date,
    summary: parsed.summary || '',
    categoryPath,
    categoryName: parsed.category || categoryName,
    mtimeMs: stat.mtimeMs,
    size: stat.size
  };
}

module.exports = {
  parseFrontmatter,
  readArticleMeta
};
