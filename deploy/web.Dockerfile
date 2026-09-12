# PlanWave 前端镜像：三阶段构建（Rust 编译 WASM 数据层 → pnpm build → nginx 托管）。
# 构建上下文必须是仓库根目录：
#   docker build -f deploy/web.Dockerfile -t planwave-web .
#
# 端口约定：容器只监听 80，由宿主上已运行的全局 Caddy 反代到此容器（TLS 由全局 Caddy 终结）。

# ---- 阶段 1：编译 WASM 同步引擎（输出 planwave.js + planwave_bg.wasm）----
FROM rust:1-slim AS wasm
RUN rustup target add wasm32-unknown-unknown \
    && cargo install wasm-pack --locked
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY crates crates
# cargo 解析 workspace 需要所有成员的清单存在（只构建 sync-wasm，不编译它们）；
# client 清单声明了 [lib]，metadata 还会校验 src/lib.rs 存在
COPY apps/server/Cargo.toml apps/server/Cargo.toml
COPY apps/client/Cargo.toml apps/client/build.rs apps/client/
COPY apps/client/src apps/client/src
RUN wasm-pack build crates/sync-wasm --target web \
    --out-dir /wasm-pkg --out-name planwave

# ---- 阶段 2：前端构建（静态站点 + WASM 一起打包）----
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@12.3.4

# 先拷贝清单以利用层缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @planwave/web...

COPY apps/web apps/web
# 装入阶段 1 产出的 WASM pkg（apps/web/src/wasm/pkg 在 .gitignore 中）
COPY --from=wasm /wasm-pkg apps/web/src/wasm/pkg
RUN pnpm --filter @planwave/web build

# ---- 阶段 3：nginx 托管 + /api 反代 ----
FROM nginx:1.27-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
