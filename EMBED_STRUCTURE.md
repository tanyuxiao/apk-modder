# APK Rebuilder 嵌入端结构说明

本说明用于梳理 `public/` 下的插件嵌入端文件结构与职责，便于后续维护与替换。

## 1. 入口与加载顺序

1. `public/embed.html`
   - 插件 iframe 的入口页面
   - 仅包含容器与脚本入口
   - 按顺序加载：
     - `embed.theme.css`（主题变量）
     - `embed.ui.css`（组件样式）
     - `embed.main.js`（脚本入口）

2. `public/embed.theme.css`
   - 统一的主题变量定义（与 vue3 插件设计指南一致）
   - 包含两套主题：
     - `:root`：日间主题
     - `body[data-mode="dark"]`：夜间主题
   - 仅负责变量，不包含具体组件样式

3. `public/embed.ui.css`
   - 嵌入端 UI 样式（容器、表单、按钮、弹层等）
   - 仅引用 `embed.theme.css` 中的变量

4. `public/embed.main.js`
   - 脚本入口，负责初始化：
     - i18n
     - UI 渲染
     - 场景号列表加载
     - 管理员区加载
     - 提交 / 轮询 / 进度
   - 接收宿主 `INIT`、`TOKEN_UPDATE` 等消息

## 2. 脚本模块划分

- `embed.host.js`：宿主通信、Token 与 PluginAuth 处理、配置解析
- `embed.ui.js`：DOM 渲染与状态更新
- `embed.scenes.js`：场景列表获取与选择逻辑
- `embed.admin.js`：管理员标准包管理
- `embed.submit.js`：提交、执行与错误处理
- `embed.progress.js`：运行状态轮询与进度展示
- `embed.i18n.js`：国际化文案与语言切换
- `embed.errors.js`：统一错误提示与 Banner

## 3. 维护约定

- 样式变量只放在 `embed.theme.css`
- 组件样式只放在 `embed.ui.css`
- `embed.html` 仅保留结构和入口，不再内联样式
