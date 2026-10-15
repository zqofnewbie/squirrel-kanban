# ---------- 1. 构建前端 ----------
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --include=optional --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------- 2. 编译后端（纯 Go，无 CGO） ----------
FROM golang:1.27.2-alpine@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS server
ARG GOPROXY=https://proxy.golang.org,direct
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download && go mod verify
COPY server/ ./
# 前端产物以 go:embed 方式打进二进制，运行镜像里不需要 node
COPY --from=web /server/static ./static
RUN CGO_ENABLED=0 GOOS=linux go build -mod=readonly -trimpath -ldflags="-s -w" -o /out/kanban .

# ---------- 3. 运行镜像 ----------
FROM alpine:3.24.2@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S -g 10001 kanban \
    && adduser -S -D -u 10001 -G kanban kanban
COPY --from=server /out/kanban /usr/local/bin/kanban
COPY LICENSE THIRD_PARTY_NOTICES.md docs/dependency-licenses.txt web/public/fonts/OFL.txt /usr/share/licenses/squirrel-kanban/
RUN mkdir -p /data && chown -R kanban:kanban /data

LABEL org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://gitee.com/storm07106038/squirrel-kanban" \
      org.opencontainers.image.title="Squirrel Kanban" \
      org.opencontainers.image.description="Lightweight bilingual kanban with SQLite"

USER 10001:10001
WORKDIR /data
ENV TZ=Asia/Shanghai \
    KANBAN_ADDR=:8080 \
    KANBAN_DATA=/data
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

CMD ["kanban"]
