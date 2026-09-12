# PlanWave 部署手册（宿主已有全局 Caddy 的服务器）

## 组成

- `planwave-server` 镜像：Rust 同步服务端（多阶段构建，容器内编译）
- `planwave-web` 镜像：前端静态资源（含 WASM 数据层）+ nginx（SPA 托管、`/api` 反代）；容器只监听 80，**默认仅绑定宿主回环地址**
- 宿主全局 Caddy：继续占用 80/443、终结 TLS，把域名反代到 web 容器
- MySQL 8.0：**云服务商托管实例，不进编排**，通过 `.env` 注入连接串

两个镜像由 GitHub CI 自动构建并推送到 GHCR（`.github/workflows/docker.yml`）：push 到 `main` 发布 `latest` + `sha-*`，打 `v*` 标签发布语义化版本；PR 只构建验证不推送。

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

5. **DNS + 全局 Caddy**：域名 A/AAAA 记录指向服务器，然后在宿主的全局 Caddy 配置里加一个站点（证书由它照常自动签发）：

   ```caddyfile
   planwave.example.com {
       reverse_proxy 127.0.0.1:8080
   }
   ```

   nginx 已把 `/api` 正确反代到后端，全局 Caddy 只需整站转发，无需再拆路径。改完 `systemctl reload caddy`。

6. **启动**：

   ```bash
   docker compose pull && docker compose up -d
   docker compose logs -f server   # 首次启动自动执行 sqlx 迁移建表
   ```

   > 服务器上没有预拉镜像时，`docker compose up -d --build` 会直接从源码构建（需要一些时间）。

7. **验收**：浏览器打开 `https://你的域名` → 注册唯一账号 → 任一端登录同一账号 → 互改任务观察秒级同步；`curl -i https://你的域名/api/health` 应返回 `{"status":"ok"}`。

## 日常运维

```bash
docker compose pull && docker compose up -d   # 滚动更新到最新镜像
docker compose logs --since 10m server
docker compose restart server
```

## 说明

- 服务端在启动时自动跑迁移；`account` 表至多一行（单用户设计），忘记密码直接清空 `account` 表重新初始化即可。
- WS 心跳 25s；nginx 侧 `proxy_read_timeout` 已放宽到 1h，国内访问香港链路抖动时，客户端以指数退避重连并容忍离线操作——同步不依赖长连接存活。
- 备份重点是云 MySQL 实例本身；oplog 与投影都在其中。
