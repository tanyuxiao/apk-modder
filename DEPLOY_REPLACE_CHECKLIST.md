# APK Rebuilder 上线替换清单

> 目标：只替换真实域名与真实接口即可上线。

## 1. 宿主端 `plugins.json` 需替换项

文件：`vue3/public/config/plugins.json`

插件 `apk-rebuilder` 需要替换：

- `url`
  - 当前：`/apk-rebuilder/embed.html`
  - 替换为：`https://<插件子域名>/apk-rebuilder/embed.html`

- `allowedOrigin`
  - 当前：`*`
  - 替换为：`https://<插件子域名>`

- `extraConfig.apiBase`
  - 当前：`/apk-rebuilder`
  - 替换为：`https://<插件子域名>/apk-rebuilder`

- `extraConfig.tenantId`
  - 若后端需要 `X-Tenant-Id` 则保留
  - 否则可删除

- `extraConfig.auth.refreshAccessTokenUrl`
  - 设置为真实宿主后端接口

- `extraConfig.auth.pluginTokenUrl`
  - 设置为真实宿主后端接口

- `extraConfig.auth.sceneListUrl`
  - 设置为真实宿主后端接口

## 2. 宿主后端接口响应字段

插件期望字段如下：

- 刷新 AccessToken：
  - `accessToken`
  - `accessTokenExp`

- 获取 PluginToken：
  - `pluginToken`
  - `pluginTokenExp`

- 场景列表：
  - `data: [{ id, name }]`

## 3. 域名 / 代理

- 插件资源可访问：
  - `https://<插件子域名>/apk-rebuilder/embed.html`

- 反向代理示例：

```
server {
  server_name <插件子域名>;

  location /apk-rebuilder/ {
    proxy_pass http://apk-rebuilder-service/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

## 4. Sandbox 与 Origin

- `allowedOrigin` 必须与 iframe 实际域名完全一致
- `sandbox` 需包含所需权限

## 5. 验证清单

- 打开插件页面
- 确认：
  - 语言 / 主题参数生效
  - AccessToken 刷新成功
  - PluginToken 获取成功
  - 场景列表加载成功
  - 执行 → 轮询 → 下载完整闭环
