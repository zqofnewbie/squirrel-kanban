# 看板 · Kanban

一个轻量、好看、交互手感接近板栗看板的自建看板。单容器、单端口、SQLite 单文件存储，Docker Compose 一条命令起来。

## 特性

- **轻量**：Go 单二进制 + 纯 Go 的 SQLite 驱动（无 CGO），运行镜像约 25MB，常驻内存 15–30MB
- **零外部依赖**：没有 Redis、Nginx、消息队列，`/data` 一个目录就是全部状态
- **交互**：跨列拖拽、列表拖拽、就地改标题、连续建卡、乐观更新 + SSE 多端实时同步
- **卡片**：Markdown 描述、彩色标签、清单进度、截止日期、封面色、附件
- **账号**：管理员在页面上建号，**不开放注册**；bcrypt 加盐哈希，会话走 HttpOnly Cookie
- **细节**：暗色模式、命令面板（`Ctrl/Cmd + K`）、筛选、归档箱、WIP 上限

## 快速开始

```bash
docker compose up -d
# 打开 http://127.0.0.1:8080
```

首次启动会按环境变量自动创建超级管理员（默认 `admin` / `admin`），登录后首页会提示先改密码。

> 默认只监听 `127.0.0.1`。要让局域网访问，把 `docker-compose.yml` 里的端口改成 `"8080:8080"`，
> 并建议在前置反代上再加一层访问控制。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `KANBAN_ADDR` | `:8080` | 监听地址 |
| `KANBAN_DATA` | `/data` | 数据目录，存放 `kanban.db` 与 `files/` |
| `KANBAN_ADMIN_USER` | `admin` | 首次启动时自动创建的超级管理员登录名 |
| `KANBAN_ADMIN_PASS` | `admin` | 初始密码（仅在首次初始化时生效） |
| `KANBAN_DEV` | 空 | 设为 `1`/`true` 等同于 `-dev`（请求日志 + 本地 CORS + 首页引导） |

## 备份

数据全部在挂载的 `./data` 目录里：

```bash
# 在线备份（推荐，不需要停服务）
docker compose exec kanban sh -c 'sqlite3' # 镜像内未带 sqlite3，用下面的离线方式

# 离线备份：停服务后整个目录拷走即可
docker compose down
cp -r data data-backup-$(date +%F)
docker compose up -d
```

不停机的一致性备份可以复制 WAL 安全的三件套：

```bash
docker compose stop kanban
cp data/kanban.db data/kanban.db-wal data/kanban.db-shm /backup/
docker compose start kanban
```

## 本地开发

需要 Go 1.24+ 与 Node 22+。**一条命令起全套**：

```bash
# Windows：双击 dev.bat（或命令行 ./dev.bat）
# macOS / Linux / Git Bash：
./dev.sh
```

会开两个进程：后端 Go（`127.0.0.1:8090`）+ 前端 Vite（`127.0.0.1:5173`）。
浏览器打开 **http://127.0.0.1:5173**，账号 `admin` / `admin`。

也可以手动分开跑（等价）：

```bash
# 后端：-dev 会打开请求日志、放宽本地 CORS、首页显示引导页
cd server && go run . -dev -addr 127.0.0.1:8090 -data ../.dev

# 前端：/api 与 /files 已代理到 8090
cd web && npm install && npm run dev
```

几个约定：

| 项 | 值 | 原因 |
| --- | --- | --- |
| 后端端口 | `8090` | docker 用 8080，dev 错开，避免和你本地已有的服务打架 |
| 数据目录 | `.dev/` | 与 docker 的 `./data` 隔离；**删掉即重置**，含默认管理员 |
| 前端地址 | `127.0.0.1:5173` | 固定绑 IPv4。别用 `localhost`——它在浏览器里是另一个 cookie 域，会出现"登录了却提示未登录" |
| Go 热重载 | air（可选） | 装了 `air` 脚本会自动用它，`server/.air.toml` 已配好；没装就 `go run`，改 Go 代码手动重启 |

改后端端口时两处要同步：`dev.bat` / `dev.sh` 的 `API_PORT`，以及前端的
`KANBAN_API` 环境变量（`KANBAN_API=http://127.0.0.1:9090 npm run dev`）。

前端 `npm run build` 会直接产出到 `../server/static`，随后 `go build` 时通过 `go:embed` 打进二进制。

## 目录结构

```
kanban/
├── docker-compose.yml
├── Dockerfile              # 三阶段：node 构建前端 → golang 编译 → alpine 运行
├── dev.bat / dev.sh        # 本地开发一键启动（后端 + Vite）
├── server/                 # Go 后端（package main）
│   ├── main.go             # 启动、路由、SPA 回退、dev 中间件
│   ├── .air.toml           # 可选：Go 热重载配置
│   ├── store*.go           # SQLite 访问层
│   ├── api*.go             # HTTP handlers
│   ├── auth.go             # bcrypt + 会话中间件
│   ├── hub.go              # SSE 广播
│   ├── schema.sql          # 建表（幂等）
│   └── static/             # 前端构建产物（go:embed）
└── web/                    # React + Vite + Tailwind
    └── src/
```

## 实现要点

- **排序用 REAL 类型的 `position`**，拖拽时取相邻两个位置的中间值，一次拖拽只 UPDATE 一行；
  浮点精度耗尽时自动重整（也可在看板菜单手动触发「整理序号」）。
- **SQLite 单写连接** (`SetMaxOpenConns(1)`) + WAL + `busy_timeout`，彻底避免 `database is locked`。
  注意：不要在遍历 `rows` 的过程中再发起查询，否则会死锁——代码里已全部规避。
- **实时同步**走 SSE，事件里带 `actor`（会话标识），客户端忽略自己发出的回声，
  保证乐观更新不会被自己的广播覆盖。
- **结构类变更**（列/标签增删）直接整块刷新看板，简单可靠；**卡片类变更**走增量合并，拖拽不闪。

## API

所有 `/api/*`（除 `POST /api/auth/login`）都要求登录；`/api/users` 的写操作要求管理员角色。

```
POST   /api/auth/login | logout          PATCH /api/auth/password | profile
GET    /api/users                        POST/PATCH/DELETE /api/users[/:id]   (管理员写)
GET    /api/boards                       POST  /api/boards
GET    /api/boards/:id                   PATCH/DELETE /api/boards/:id
GET    /api/boards/:id/archived          POST  /api/boards/:id/columns | labels | normalize
POST   /api/columns/:id/cards | move     PATCH/DELETE /api/columns/:id
GET    /api/cards/:id                    PATCH/DELETE /api/cards/:id
POST   /api/cards/:id/move | labels | checklists | attachments
PATCH/DELETE /api/checklists/:id         POST/PATCH/DELETE /api/checklists/:id/items
DELETE /api/attachments/:id              GET  /api/events (SSE)
```
