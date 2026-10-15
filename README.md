# originates-web

Originates 网站与真实账户认证基础版本。**此版本完成注册 / 登录 / 会话 / 退出 / 账户页，不是完整 AI 工作流平台。**

## 本次修复

- 修复原首页大量损坏的结束标签，保留原有页面内容、深色风格，并加入可用性说明。
- 新增 `/login` 注册/登录表单，`/app` 受保护账户页，以及失败/网络错误反馈。
- 新增 Node.js 24 + SQLite 后端，无第三方运行时依赖。
- 密码使用随机盐及 scrypt（N=32768, r=8, p=3）派生，数据库不保存明文密码。
- 随机不透明会话令牌，数据库仅保存其 SHA-256 摘要；7 天到期，退出即时失效。
- HttpOnly、SameSite=Lax Cookie；生产环境增加 Secure 及 `__Host-` 前缀。
- Origin 校验、JSON 请求校验、请求体大小限制、持久化限流、并发密码派生限制。
- 限制公开文件白名单、CSP 等响应头；SQLite 数据目录不在公开目录。
- 提供 Docker、Compose、Caddy 反向代理样例、CI 测试。

## 本地启动

需要 Node.js **24.14.0 或以上**，建议使用 Dockerfile 中固定的 Node 24.14.1。
Node 内置 SQLite 当前会提示实验性警告；无须安装 npm 包。

```sh
npm test
npm start
```

打开 `http://localhost:3000`，选择 “Log in / Sign up”。先创建账户，再用同一邮箱和密码登录。密码长度 12–128 字符。注册操作为避免泄露账户是否存在，对新邮箱和已有邮箱返回同一提示，不会覆盖已有密码。

默认数据库：`./data/originates.sqlite`。用户和会话在服务重启后仍保留。不要使用 `file://`、普通静态文件服务器或 GitHub Pages 验证认证功能。

可选配置（环境变量直接传入，Node 不会自动加载 `.env`）：

```sh
PORT=3000 APP_ORIGIN=http://localhost:3000 DATA_DIR=./data npm start
```

## 部署前必须了解

1. **GitHub Pages 只能提供静态页面，不能执行本项目后端。** 根目录 `index.html` 仅为静态首页兼容副本，真正运行入口是 `server.mjs` 和 `public/`。
2. 使用可运行 Node/Docker、具有持久磁盘的主机；不要把 SQLite 数据放在临时容器文件系统，也不要在多个副本间复制同一个数据库。此实现限定单实例。
3. 生产环境必须设置 `NODE_ENV=production`、`APP_ORIGIN=https://你的域名`，并提供有效 TLS。缺少 HTTPS Origin 时应用拒绝启动。
4. 本地排查访问 `https://originates.dev` 曾返回 **TLS 证书主机名不匹配**。这不是仅提交代码就能解决的问题，必须检查 DNS、绑定域名、平台证书。没有绕过 TLS 校验。
5. 初次本地交付阶段尚未发布。后续已获得 GitHub 授权，仓库与 Pages 配置的实际发布进展请查看 GitHub 提交和部署记录。本 Node 后端仍需要独立服务器，不能在 Pages 执行。

### 单机 Docker Compose + 主机 Caddy

以下是部署模板，并未在真实主机执行。需已安装 Docker Compose 和 Caddy。

```sh
docker compose up -d --build
curl http://127.0.0.1:3000/api/health
```

Compose 仅将服务端口绑定到主机的 `127.0.0.1:3000`。使用仓库 `Caddyfile` 的内容配置主机 Caddy（按现有配置合并，切勿覆盖其他站点）：

```caddyfile
originates.dev {
    reverse_proxy 127.0.0.1:3000
}
```

- DNS 的 A/AAAA 应指向部署主机；若此前使用 GitHub Pages 的 CNAME，需按实际部署方式替换，不可保留冲突记录。
- 确保 TCP 80/443 可访问，Caddy 才能完成证书签发及提供 HTTPS。
- Caddy 在**主机**运行；若改成容器，不能继续把上游写为容器内的 `127.0.0.1`。
- 若用其他托管平台：部署为 Web Service，运行 `npm start`，挂持久卷并设置 `DATA_DIR` 和 `APP_ORIGIN`。不能选择 Static Site。
- 反向代理统一入口并禁止公网直连 Node 端口。应用故意不信任 X-Forwarded-For，因此代理后 IP 限流会聚合到代理地址；当前适合低流量预览，高流量上线前需按平台配置可信代理及边缘限流。

## 发布验收

- `https://originates.dev` 的证书域名正确，浏览器无 TLS 警告。
- `/api/health` 返回 `{"ok":true}`。
- 无会话访问 `/app` 跳到 `/login`；访问 `/api/me` 返回 401。
- 新邮箱注册后可登录；错误密码显示明确失败信息。
- 浏览器 Cookie 使用 `__Host-originates_session` 并带 Secure、HttpOnly、SameSite=Lax。
- 退出后原会话不可再次访问 `/api/me`。
- 重启容器后既有账户仍能登录。
- 手机页面没有横向滚动，键盘操作和表单标签可用。

## API

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/health` | GET | 存活检查 |
| `/api/register` | POST | 注册，JSON `{email,password}` |
| `/api/login` | POST | 登录，设置会话 Cookie |
| `/api/me` | GET | 当前账户，未登录返回 401 |
| `/api/logout` | POST | 撤销当前会话 |

写请求必须来自 `APP_ORIGIN`。账户创建/登录必须使用 `Content-Type: application/json`。账户接口不返回密码派生结果或会话令牌。

## 运维与边界

- 持久化卷包含用户资料及密码派生结果，需限制访问，做好加密备份和备份恢复演练。备份运行中的 SQLite 应使用 SQLite 在线备份机制；不要只复制主文件而忽略 WAL。简单的停机备份可停止服务后完整备份数据目录/卷；**不要**执行 `docker compose down -v`。
- 邮箱只是登录标识，尚未验证邮箱归属；没有邮件验证、忘记密码、MFA、OAuth、团队 RBAC。
- 不包含 AI 模型调用、流程编辑器/执行器、云沙箱、CLI、API 密钥、支付和计费。
- 首页原有价格、性能、团队规模、认证等宣传文案来自原仓库，本次未核实其真实性，已增加产品预览说明；正式对外推广前应由项目负责人逐项确认/更正。
- 此版本是可运行的账户预览基础，不应冒充完整产品或经过独立安全审计的生产系统。

## 已完成验证

- `npm test`：14 项认证、安全与持久化集成测试通过。
- 本地 Chromium：注册 → 错误密码提示 → 正确登录 → 账户页 → 退出 → 受保护页面跳转，全流程通过，无页面 JS 异常。
- 桌面 1440px / 手机 390px：页面截图检查；登录、注册、错误提示、账户页与首页布局已检查。
- Docker 镜像构建、真实 TLS、DNS 迁移和托管平台发布尚未在本环境验证。
