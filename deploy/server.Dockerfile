# PlanWave 服务端镜像：多阶段构建（容器内编译 → 精简运行时）
# 构建上下文为仓库根目录：
#   docker build -f deploy/server.Dockerfile -t planwave-server .
FROM rust:1-slim AS builder
WORKDIR /build
# 先拷贝依赖清单以利用层缓存；apps/client 是 workspace 成员，cargo 解析 workspace
# 需要其清单与目标文件存在（本镜像只构建 planwave-server，不编译客户端）。
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY apps/server apps/server
COPY apps/client apps/client
RUN cargo build --release -p planwave-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/planwave-server /usr/local/bin/planwave-server
# sqlx migrate! 已把迁移嵌入二进制，无需额外文件
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/planwave-server"]
