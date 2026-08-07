# 代码浏览模板

在需要浏览代码的 HTML 中，把下面这一行放到希望显示代码浏览器的位置：

```html
<script src="/templates/CodeBrowser/code-browser.js" data-code-browser data-article="notes/0x0 - Inbox/示例.html"></script>
```

`data-article` 填写当前 HTML 在项目中的路径。模板会根据它自动寻找同级的 `code - 文件名` 目录（文件名不含 `.html`）。例如：

```text
notes/
└─ 0x0 - Inbox/
   ├─ BlueprintLibraryPlugin解析.html
   └─ code - BlueprintLibraryPlugin解析/
      ├─ BaseBlueprintLibrary.uplugin
      └─ Source/
         └─ BaseBlueprintLibrary/
            ├─ BaseBlueprintLibrary.Build.cs
            ├─ Public/
            │  └─ BaseBlueprintLibrary.h
            └─ Private/
               └─ BaseBlueprintLibrary.cpp
```

对应关系是严格的：`示例.html` 只会读取 `code - 示例/`，不会读取同级的其他文件或目录。目录中的 Markdown、HTML 等文件只是代码浏览资源，不会进入文章索引。

模板使用 Shadow DOM 隔离样式；HTML 中原有的标题、正文和其他组件不会与它冲突。后续只需要更新本目录内的 `code-browser.js` 和 `code-browser.css`，所有引用该模板的文章都会同步使用新版。
