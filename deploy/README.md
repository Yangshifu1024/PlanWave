# PlanWave 部署手册（宿主已有全局 Caddy 的服务器）

## 组成

- `planwave-server` 镜像：Rust 同步服务端（多阶段构建，容器内编译），绑宿主回环 `127.0.0.1:8081`
- `planwave-web` 镜像：前端静态资源（含 WASM 数据层）+ nginx 默认配置纯托管，绑宿主回环 `127.0.0.1:8080`
- 宿主全局 Caddy：继续占用 80/443、终结 TLS，**按路径分流并剥掉 `/api` 前缀**：
  - `/api/*` → 剥前缀后反代 `127.0.0.1:8081`（Axum 路由本身不带 `/api` 前缀）
  - 其余 → `127.0.0.1:8080`（web 静态资源）
- MySQL 8.0：**云服务商托管实例，不进编排**，通过 `.env` 注入连接串

两个镜像由 GitHub CI 的 `release.yml` 在打 `v*` 标签时自动构建并推送到 GHCR（semver + latest）。

## 步骤

1. **镜像**：CI 推送后，镜像位于 `ghcr.io/<你的用户名>/planwave-server` 与 `...-web`。首次拉取 GHCR 私有包需在服务器上 `docker login ghcr.io`（用户名 + PAT，需 `read:packages`）；也可以把包设为 public。

2. **准备 MySQL**：在云控制台创建数据库（如 `planwave`）与专用账号；确认服务器能通过内网地址访问 3306（不要暴露公网）。

3. **上传 `deploy/` 目录到服务器**：

   ```
   /opt/planwave/
   ├── docker-compose.yml
   └── .env
   ```

4. **写 `.env`**：

   ```bash
   DATABASE_URL=mysql://planwave:密码@内网主机:3306/planwave
   PLANWAVE_JWT_SECRET=<openssl rand -base64 64>
   PLANWAVE_SERVER_IMAGE=ghcr.io/<你的用户名>/planwave-server:latest
   PLANWAVE_WEB_IMAGE=ghcr.io/<你的用户名>/planwave-web:latest
   WEB_BIND=127.0.0.1
   WEB_PORT=8080
   ```

5. **DNS + 全局 Caddy**：域名 A/AAAA 记录指向服务器，然后在宿主的全局 Caddy 配置里加一个站点（证书由它照常自动签发）。**关键：`/api` 前缀由 Caddy 剥掉**（服务端路由本身不带前缀）：

   ```caddyfile
   task.example.com {
       handle /api/* {
           uri strip_prefix /api
           reverse_proxy 127.0.0.1:8081
       }
       handle {
           reverse_proxy 127.0.0.1:8080
       }
   }
   ```

   改完 `systemctl reload caddy`。漏掉 `uri strip_prefix /api` 会在注册时报 404（Axum 收到的是 `/api/auth/register`）。

6. **启动**：

   ```bash
   docker compose pull && docker compose up -d
   docker compose logs -f server   # 首次启动自动执行 sqlx 迁移建表
   ```

   > 服务器上没有预拉镜像时，`docker compose up -d --build` 会直接从源码构建（需要一些时间）。

7. **验收**：`curl -s https://你的域名/api/health` 应返回 `{"status":"ok"}`；浏览器打开 `https://你的域名` → 注册唯一账号 → 任一端登录同一账号 → 一端改动、另一端点刷新按钮即可看到同步。

## 日常运维

```bash
docker compose pull && docker compose up -d   # 滚动更新到最新镜像
docker compose logs --since 10m server
docker compose restart server
```

## 说明

- 服务端在启动时自动跑迁移；`account` 表至多一行（单用户设计），忘记密码直接清空 `account` 表重新初始化即可。
- 同步是拉取式：客户端本地写即时生效 + 防抖自动推送；多端一致性由启动/聚焦/定时轮询/手动刷新保证，服务端无长连接状态，重启不影响客户端。
- 备份重点是云 MySQL 实例本身；oplog 与投影都在其中。
