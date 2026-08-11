# KAOJJ ACP 静态刷题服务

这是一个不需要后端的 GitHub Pages / GitHub 静态部署版本。手机、平板、Windows 和 macOS 都可以通过浏览器打开；支持 PWA 的设备可以添加到主屏幕。

## GitHub Pages 部署

1. 新建一个 GitHub 仓库。
2. 将本目录中的文件放到仓库根目录。
3. 在仓库的 `Settings → Pages` 中选择 `Deploy from a branch`，选择默认分支的 `/ (root)`。
4. 等待 GitHub Pages 发布，用生成的地址访问即可。

也可以把这些文件放在仓库的 `docs/` 目录，再在 Pages 中选择 `/docs`。

题库已经在构建时写入 `question-bank.js`，访问者不需要上传、导入或选择任何题目文件。

## 使用

1. 在任意设备打开页面，直接开始答题。
2. 选择题目选项并提交；每题答对次数超过 3 次后自动移出队列。
3. “导出进度”会下载统计 JSON；在另一台设备点击“导入进度 JSON”即可迁移进度。
4. 可以在右侧调整答对阈值。数据默认只保存在当前浏览器的 `localStorage` 中。

## 静态部署的边界

GitHub Pages 只托管静态文件，不提供账号或数据库。因此它能让所有设备打开同一个刷题页面，但不会自动合并不同设备的答题统计；跨设备统计需要手动导出/导入备份。后续如果需要账号登录和自动同步，可以在不改动题库解析规则的前提下接入 API/数据库。

如需更新内置题库，可在本地运行 `python build_question_bank.py <源 Markdown> question-bank.js` 后重新部署。网页运行时不会解析或上传 Markdown。
