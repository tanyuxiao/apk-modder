# APK Rebuilder 插件对接说明（草案）

> 状态：草案。接口字段可替换，主要用于前端与宿主后端对齐。

## 1. 插件入口

- URL：`/apk-rebuilder/embed.html`
- 宿主（vue3）会通过 iframe URL 参数传入：
  - `lang`、`theme`
  - 例如：`?lang=zh-CN&theme=light`

## 2. Token 与鉴权流程

### 2.1 AccessToken（用户身份 Token）
- 表示用户身份
- 用于：
  - 请求 PluginToken（插件权限 Token）
  - 获取当前用户的场景列表
- 有有效期，需要刷新

### 2.2 PluginToken（插件权限 Token）
- 表示插件使用权限
- 用于插件执行相关接口

### 2.3 INIT 消息（宿主 -> 插件）

推荐格式（字段可替换）：

```json
{
  "type": "INIT",
  "payload": {
    "accessToken": "<user-token>",
    "pluginToken": "<plugin-token>",
    "accessTokenExp": 1719999999,
    "pluginTokenExp": 1719999999,
    "config": {
      "apiBase": "/apk-rebuilder",
      "tenantId": "apkrebuilder-mrpp",
      "auth": {
        "pluginTokenUrl": "https://host-api/token/b",
        "refreshAccessTokenUrl": "https://host-api/token/refresh",
        "sceneListUrl": "https://host-api/user/scenes"
      }
    }
  }
}
```

说明：
- `accessTokenExp` / `pluginTokenExp` 可以是秒或毫秒
- 若未提供 `pluginToken`，插件会调用 `pluginTokenUrl` 获取

### 2.4 刷新 AccessToken

```
POST {refreshAccessTokenUrl}
Authorization: Bearer <accessToken>
```

推荐响应：
```json
{
  "accessToken": "...",
  "accessTokenExp": 1719999999
}
```

### 2.5 获取 PluginToken

```
POST {pluginTokenUrl}
Authorization: Bearer <accessToken>
```

推荐响应：
```json
{
  "pluginToken": "...",
  "pluginTokenExp": 1719999999
}
```

## 3. 场景列表（AccessToken）

```
GET {sceneListUrl}
Authorization: Bearer <accessToken>
```

推荐响应（标准）：
```json
{
  "data": [
    { "id": 1001, "name": "Demo Scene" }
  ]
}
```

兼容格式：
- `{ "scenes": [...] }`
- `[ ... ]`

## 4. 插件执行（PluginToken）

Base URL：`apiBase`（来自 INIT config）

### 4.1 执行
```
POST {apiBase}/plugin/execute
Authorization: Bearer <pluginToken>
Content-Type: application/json
```

### 4.2 查询状态
```
GET {apiBase}/plugin/runs/{runId}
Authorization: Bearer <pluginToken>
```

### 4.3 下载产物
```
GET {apiBase}/plugin/artifacts/{artifactId}?tenantId=xxx
Authorization: Bearer <pluginToken>
```

### 4.4 上传图标
```
POST {apiBase}/plugin/icon-upload
Authorization: Bearer <pluginToken>
```

## 5. 管理员接口（PluginToken）

- `GET {apiBase}/plugin/standard-package`
- `GET {apiBase}/plugin/admin/apk-library`
- `PUT {apiBase}/plugin/admin/standard-package`
- `DELETE {apiBase}/plugin/admin/apk-library/{id}`
- `POST {apiBase}/api/upload`

## 6. 错误 UI 标准

- AccessToken 刷新失败：
  - UI 显示：`AccessToken 获取失败，请重新登录`
  - Banner 同步显示错误详情

- PluginToken 获取失败：
  - UI 显示：`插件权限获取失败`
  - Banner 同步显示错误详情

- 场景列表加载失败：
  - UI 显示：`场景加载失败`
  - Banner 同步显示错误详情

> 具体提示文案可后续调整。

## 7. 域名与代理模板（替换为真实域名）

### 7.1 宿主 plugins.json 示例

```json
{
  "url": "https://plugin.example.com/apk-rebuilder/embed.html",
  "allowedOrigin": "https://plugin.example.com",
  "extraConfig": {
    "apiBase": "https://plugin.example.com/apk-rebuilder",
    "tenantId": "apkrebuilder-mrpp",
    "auth": {
      "sceneListUrl": "https://host.example.com/api/scenes",
      "pluginTokenUrl": "https://host.example.com/api/pluginToken",
      "refreshAccessTokenUrl": "https://host.example.com/api/refreshAccessToken"
    }
  }
}
```

### 7.2 Nginx 反向代理示例

```nginx
server {
  server_name plugin.example.com;

  location /apk-rebuilder/ {
    proxy_pass http://apk-rebuilder-service/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```
