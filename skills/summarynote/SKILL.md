---
name: summary-note
description: 为 Markdown 和 HTML 文章自动创建、更新并维护元数据。根据文件名生成标题，保留已有创建日期，从正文生成摘要和标签，并依据父目录设置分类；支持 YAML Front Matter 与 HTML meta 标签，避免重复写入且保持幂等。适用于添加或更新文章 metadata、Front Matter、meta 标签、标题、摘要、分类和标签，以及明确要求的批量文章元数据整理。
---

# Markdown / HTML Metadata Manager

## 功能

为 Markdown 和 HTML 文章自动生成并维护元数据：

* Markdown 文件：在文件顶部添加 YAML Front Matter。
* HTML 文件：在 `<head>` 中添加 `<meta>` 标签。
* `summary` 由当前执行任务的 Agent 根据文章正文生成。
* `tags` 由当前 Agent 根据文章主题和类型自动标注。
* 已存在元数据时进行更新，不得重复添加。

## 适用场景

当用户提出以下需求时使用此 Skill：

* 给文章添加 metadata。
* 给 Markdown 添加 Front Matter。
* 给 HTML 添加 meta 标签。
* 批量整理文章元数据。
* 补充文章标题、摘要、分类或标签。
* 创建或更新博客文章的元数据。

## 支持的文件类型

### Markdown

支持扩展名：

* `.md`
* `.markdown`

### HTML

支持扩展名：

* `.html`
* `.htm`

其他类型的文件不进行修改。

## 元数据生成规则

### title

使用当前文件的文件名，不包含扩展名。

示例：

```text
文件路径：notes/UnrealEngine/Niagara粒子位置更新.md
title：Niagara粒子位置更新
```

### date

使用元数据首次创建时的当前日期，格式为：

```text
YYYY-MM-DD
```

示例：

```text
2026-07-13
```

如果文件中已经存在有效的 `date`，默认保留原日期，不要因为更新摘要或标签而覆盖创建日期。

### summary

由当前执行任务的 Agent 阅读文章正文后生成。

要求：

* 准确概括文章的核心内容。
* 使用一段简洁的自然语言。
* 不使用 Markdown 格式。
* 不换行。
* 不直接复制文章开头。
* 建议控制在 100 个中文字符以内。
* 不加入“本文介绍了”“这篇文章讲解了”等无意义开头。
* 不包含未在文章中出现的信息。

示例：

```text
如何注册 UE 源码引擎，并让现有工程关联和使用已编译完成的源码引擎。
```

### category

使用文件所在的直接父文件夹名称。

示例：

```text
文件路径：notes/UnrealEngine/Niagara粒子位置更新.md
category：UnrealEngine
```

特殊情况：

* 不使用完整文件路径。
* 不自动翻译文件夹名称。

### tags

由当前执行任务的 Agent 根据文章内容自动生成。

要求：

* 选择能够表达文章主题、技术领域和内容类型的关键词。
* 标签应简短、明确。
* 不添加与正文无关的标签。
* 避免意义重复的标签。
* 优先使用正文中实际出现的技术名称。
* 保持项目中已有标签的语言和命名习惯。
* Markdown 中使用 YAML 数组。
* HTML 中使用 `|` 分隔。

示例：

```text
Unreal Engine
UE5
源码引擎
工程配置
```

## Markdown 处理规则

### 输出格式

在 Markdown 文件最顶部加入：

```yaml
---
title: "文件名称"
date: "创建日期"
summary: "文章总结"
category: "所在文件夹名称"
tags:
  - "tag1"
  - "tag2"
---
```

元数据结束标记后保留一个空行，再接文章正文。

完整示例：

```markdown
---
title: "使用源码引擎打开 UE 工程"
date: "2026-07-13"
summary: "讲解如何注册 UE 源码引擎，并让现有工程关联和使用已编译完成的源码引擎。"
category: "UnrealEngine"
tags:
  - "Unreal Engine"
  - "UE5"
  - "源码引擎"
  - "工程配置"
---

# 使用源码引擎打开 UE 工程

正文内容……
```

### 已存在 Front Matter 时

如果文件顶部已经存在由 `---` 包围的 YAML Front Matter：

1. 读取现有元数据。
2. 更新 `title`、`summary`、`category` 和 `tags`。
3. 已存在有效 `date` 时保留原日期。
4. 缺少 `date` 时添加当前日期。
5. 保留不属于本 Skill 管理范围的其他字段。
6. 不得创建第二个 Front Matter。
7. Front Matter 必须始终位于文件最顶部。

### YAML 安全要求

* 字符串值默认使用双引号。
* 对双引号和反斜杠进行正确转义。
* `summary` 必须保持为单行字符串。
* 不破坏文章正文原有内容。
* 不将正文中的 `---` 误判为顶部 Front Matter。

## HTML 处理规则

### 输出格式

在 HTML 文档的 `<head>` 标签中加入：

```html
<meta name="title" content="文件名称">
<meta name="date" content="创建日期">
<meta name="summary" content="文章总结">
<meta name="category" content="所在文件夹名称">
<meta name="tags" content="tag1|tag2|tag3">
```

建议放置位置：

1. `<meta charset>` 之后。
2. `<title>` 之前。
3. 如果不存在 `<meta charset>`，则放在 `<head>` 开始标签之后。

完整示例：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="title" content="使用源码引擎打开 UE 工程">
  <meta name="date" content="2026-07-13">
  <meta name="summary" content="讲解如何注册 UE 源码引擎，并让现有工程关联和使用已编译完成的源码引擎。">
  <meta name="category" content="UnrealEngine">
  <meta name="tags" content="Unreal Engine|UE5|源码引擎|工程配置">
  <title>使用源码引擎打开 UE 工程</title>
</head>
<body>
  正文内容……
</body>
</html>
```

### 已存在 meta 标签时

对于以下标签，通过 `name` 属性识别：

```html
<meta name="title">
<meta name="date">
<meta name="summary">
<meta name="category">
<meta name="tags">
```

处理规则：

1. 标签已存在时更新其 `content`。
2. 标签不存在时创建。
3. 已存在有效 `date` 时保留原日期。
4. 不得生成相同 `name` 的重复标签。
5. 属性顺序不同、大小写不同或使用单引号时，仍应识别为已有标签。
6. 不修改无关的 `<meta>` 标签。
7. 不使用 Open Graph 标签代替这些元数据。

### 缺少 head 标签时

如果 HTML 文件存在 `<html>`，但不存在 `<head>`：

```html
<html>
<body>
```

则创建：

```html
<html>
<head>
  <!-- metadata -->
</head>
<body>
```

如果文件是 HTML 片段，既不存在 `<html>` 也不存在 `<head>`，默认不要强行添加完整 HTML 文档结构，除非用户明确要求。

### HTML 安全要求

写入 `content` 属性前，必须转义：

* `&` → `&amp;`
* `"` → `&quot;`
* `<` → `&lt;`
* `>` → `&gt;`

不得因为插入元数据而破坏原有 HTML 缩进、脚本、样式或文档结构。

## 内容分析流程

处理每个文件时，按照以下顺序执行：

1. 判断文件扩展名。
2. 读取文件正文和已有元数据。
3. 确定标题。
4. 获取首次创建日期或保留已有日期。
5. 根据文件父目录确定分类。
6. 忽略已有摘要，重新阅读正文并判断文章核心。
7. 生成准确、简洁的摘要。
8. 根据文章主题生成标签。
9. 合并或更新已有元数据。
10. 检查是否出现重复字段或重复标签。
11. 保存文件。
12. 验证正文内容没有被意外删除或修改。

生成摘要和标签时，不应将以下内容作为正文依据：

* Markdown Front Matter。
* HTML `<meta>` 元数据。
* 导航栏、页脚和通用网站模板。
* 代码生成工具的固定说明。
* 与当前文章无关的推荐内容。

## 幂等性要求

此 Skill 必须是幂等的。

同一个文件连续执行多次时：

* 不会反复插入相同元数据。
* 不会生成多个 YAML Front Matter。
* 不会生成重复的 HTML `<meta>` 标签。
* 在正文未发生变化时，摘要和标签应尽量保持稳定。
* 不会改变与元数据无关的内容。

## 批量处理规则

用户明确要求批处理文档是才可执行！否则只会处理当前引用的文档。

处理目录时：

* 递归查找notes文件夹下的 Markdown 和 HTML 文件。
* 每个文件必须单独根据正文生成摘要和标签。
* 不允许为所有文件使用相同摘要或固定标签。
* 单个文件处理失败时，记录错误并继续处理其他文件。

## 修改结果报告

完成后输出简洁报告：

```text
已处理 12 个文件：

- 新增元数据：8
- 更新元数据：3
- 无需修改：1
- 处理失败：0
```

必要时列出失败文件及原因，但不要输出整篇文章内容。

## 禁止行为

* 不凭空生成文章中不存在的结论。
* 不使用文件修改日期冒充创建日期。
* 不重复插入元数据。
* 不删除未知的 YAML 字段。
* 不删除无关的 HTML `<meta>` 标签。
* 不修改正文标题来配合元数据。
* 不把目录完整路径写入 `category`。
* 不把标签写成一整句描述。
* 不在 Markdown 正文之前加入 Front Matter 以外的说明。
* 不在 HTML `<body>` 中添加元数据。