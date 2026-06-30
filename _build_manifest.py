#!/usr/bin/env python3
"""
扫描 public/posts/ 下所有 .html 文件，生成 manifest.json。

文件命名约定（可选）：
  2026-03-12-some-title.html   → 会被识别为日期 + 标题

每篇文章的 HTML 应包含这些 meta：
  <meta name="title"    content="...">   文章标题
  <meta name="summary"  content="...">   列表里的总结（必填）
  <meta name="date"     content="2026-03-12">  发布日期
  <meta name="read-time" content="6 min">       阅读时长
  <meta name="category" content="Essays">       分类

用法：
  python3 _build_manifest.py [扫描根目录，默认 ./posts]
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).parent.resolve()
POSTS = ROOT / "posts"
OUTPUT = ROOT / "manifest.json"


def extract_meta(html: str) -> dict:
    """从一个 HTML 文件里读 meta 标签。"""
    out = {}
    # <meta name="X" content="Y">
    for m in re.finditer(
        r'<meta\s+name=["\'](\w[\w-]*)["\']\s+content=["\']([^"\']*)["\']',
        html, re.IGNORECASE,
    ):
        out[m.group(1).lower()] = m.group(2)
    # 也支持 content 在前的写法
    for m in re.finditer(
        r'<meta\s+content=["\']([^"\']*)["\']\s+name=["\'](\w[\w-]*)["\']',
        html, re.IGNORECASE,
    ):
        out[m.group(2).lower()] = m.group(1)
    return out


def parse_filename(name: str) -> tuple[str, str]:
    """返回 (display_title, date_str)。
    文件名：on-quietness.html 或 2026-03-12-on-quietness.html
    """
    base = re.sub(r'\.html$', '', name, flags=re.IGNORECASE)
    m = re.match(r'^(\d{4}-\d{2}-\d{2})-(.+)$', base)
    if m:
        date_str, slug = m.group(1), m.group(2)
    else:
        date_str, slug = '', base
    # 转标题：on-quietness → On Quietness
    title = slug.replace('_', ' ').replace('-', ' ').strip()
    title = re.sub(r'\s+', ' ', title)
    title = title[:1].upper() + title[1:] if title else base
    return title, date_str


def build_tree(root: Path, base: Path, parent_path: str = '') -> dict | None:
    """递归建树。
    parent_path：父节点的相对路径前缀（用于拼接子节点 path）。
    """
    if not root.exists():
        return None

    # 计算相对路径名
    rel = root.relative_to(base)
    name = rel.parts[-1] if rel.parts else 'posts'
    # 节点自身的 path 是相对 posts 根的
    if parent_path:
        node_path = f"{parent_path}/{name}"
    else:
        node_path = name  # 顶层 = 'posts'

    node = {
        'name': name,
        'path': node_path,
        'type': 'folder',
        'children': [],
        'count': 0,
    }

    # 收集文件
    files = sorted(root.glob('*.html'))
    for f in files:
        try:
            html = f.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            html = f.read_text(encoding='gbk', errors='replace')

        meta = extract_meta(html)
        title_from_meta = meta.get('title', '').strip()
        title_from_file, date_from_file = parse_filename(f.name)

        # 优先 meta，没有就用文件名
        title = title_from_meta or title_from_file
        date  = meta.get('date', '').strip() or date_from_file
        summary = meta.get('summary', '').strip()
        read_time = meta.get('read-time', '').strip()

        node['children'].append({
            'name': f.name,
            'path': f"{node_path}/{f.name}",
            'type': 'file',
            'title': title,
            'date': date,
            'summary': summary,
            'readTime': read_time,
            'category': meta.get('category', '').strip(),
        })
        node['count'] += 1

    # 递归子目录
    subdirs = sorted([d for d in root.iterdir() if d.is_dir()])
    for d in subdirs:
        child = build_tree(d, base, parent_path=node_path)
        if child:
            node['children'].append(child)
            node['count'] += child['count']

    # 排序：文件夹在前，文件在后；同级按 name 升序
    node['children'].sort(key=lambda c: (c['type'] != 'folder', c['name'].lower()))

    return node


def main():
    if not POSTS.exists():
        print(f"[!] 找不到 {POSTS}", file=sys.stderr)
        sys.exit(1)

    tree = build_tree(POSTS, POSTS)
    if not tree:
        print("[!] posts 目录是空的", file=sys.stderr)
        sys.exit(1)

    # 顶层包成 "posts" 文件夹
    manifest = {
        'name': 'posts',
        'path': 'posts',
        'type': 'folder',
        'children': tree['children'],
        'count': tree['count'],
        'generated': datetime.now().isoformat(timespec='seconds'),
    }

    OUTPUT.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )
    print(f"[✓] 已生成 {OUTPUT.relative_to(ROOT)}")
    print(f"    {manifest['count']} 篇 / {sum(1 for _ in POSTS.rglob('*.html'))} 个 .html 文件")


if __name__ == '__main__':
    main()