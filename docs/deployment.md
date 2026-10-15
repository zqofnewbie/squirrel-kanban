# 部署、备份与恢复 / Deployment, backup and restore

部署入口见 [中文 README](../README.md) / [English README](../README.en.md)。所有命令在项目根目录执行。

## 配置 / Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `KANBAN_PORT` | `8080` | Host port, bound to all IPv4 interfaces by default |
| `KANBAN_VOLUME` | `squirrel-kanban-data` | Persistent Docker named volume; use a distinct name per instance |
| `KANBAN_GOPROXY` | `https://proxy.golang.org,direct` | Build-time Go module proxy |
| `KANBAN_ADDR` | `:8080` | API / static server address |
| `KANBAN_DATA` | `./data` (`/data` in Compose) | SQLite, attachments, backgrounds and preview cache |
| `KANBAN_ADMIN_USER` | `admin` | Initial super administrator; does not replace an existing account |
| `KANBAN_ADMIN_PASS` | Required in Compose | Initial production password, 12–72 bytes; existing accounts are unchanged |
| `KANBAN_COOKIE_SECURE` | `false` | Use `true` behind HTTPS; keep false for local HTTP |
| `KANBAN_PREVIEW_URL` | Unset | Optional private Gotenberg URL |
| `KANBAN_SOFFICE` | Unset | Optional local LibreOffice executable |
| `KANBAN_DEV` | `false` | Local development only |

`.env` contains secrets and must not be committed. On Windows, copy with `Copy-Item .env.example .env` and edit with your preferred editor.

## 备份 / Backup

停止写入，备份整个卷，随后恢复运行。示例用于 macOS / Linux shell；Windows 可通过 WSL 执行，避免旧版 PowerShell 的二进制重定向破坏压缩文件。

Stop writes and back up the entire volume, then restart. Use a POSIX shell (WSL on Windows) for binary redirection.

```sh
mkdir -p backups
docker compose stop kanban
docker compose run --rm --no-deps -u 0 --entrypoint tar kanban \
  -C /data -czf - . > "backups/squirrel-$(date +%F-%H%M%S).tar.gz"
docker compose start kanban
```

如果备份失败，保留原数据并重新启动服务。不要只复制正在写入的 `kanban.db`；SQLite WAL、附件和背景图必须一致保存。

If backup fails, retain the original data and restart the service. Never copy only a live `kanban.db`; keep WAL files and uploaded assets together.

## 恢复 / Restore

先备份当前数据，恢复到空卷。不要覆盖未备份的数据。

Back up existing data first. Restore into an empty volume.

恢复使用一个**全新的卷名**，保留原卷以便回滚。下面的检查会拒绝向非空卷解压。
Restore to a **new volume** and keep the original for rollback. The guard refuses
non-empty destinations. Replace the example name and backup file explicitly.

```sh
docker compose stop kanban
docker volume create squirrel-kanban-restore-20261015
docker run --rm -i -u 0 --entrypoint sh \
  -v squirrel-kanban-restore-20261015:/data alpine:3.24.2 \
  -c 'test -z "$(ls -A /data)" || exit 1; tar -xzf - -C /data && chown -R 10001:10001 /data' < backups/YOUR-BACKUP.tar.gz
```

只有上一步成功后，将 `.env` 中 `KANBAN_VOLUME` 改为新卷名，再执行：
Only after successful extraction, set `KANBAN_VOLUME` in `.env` to the new name:

```sh
docker compose config -q
docker compose up -d --wait
docker compose logs --tail=100 kanban
```

登录检查看板、附件及分享链接。失败时停止服务，将 `.env` 的卷名恢复为旧值，
再执行 `docker compose up -d --wait`。不要删除原卷直到验证完成。
Verify boards, attachments and sharing links. To roll back, stop the service,
restore the old volume name and recreate the container. Retain both volumes.

## 旧目录迁移 / Migrate an existing bind mount

停止旧服务并备份整个目录。创建全新卷，复制前确认目标为空，然后将 `.env`
中的 `KANBAN_VOLUME` 指向新卷。不要直接复用可能已有数据的默认卷。
Stop the old service and back up its whole data directory. Copy into a fresh,
empty named volume and select it through `KANBAN_VOLUME`.

```sh
docker volume create squirrel-kanban-migrated-20261015
docker run --rm -u 0 --entrypoint sh \
  -v "$PWD/data:/old:ro" -v squirrel-kanban-migrated-20261015:/data \
  alpine:3.24.2 -c 'test -z "$(ls -A /data)" || exit 1; cp -a /old/. /data/ && chown -R 10001:10001 /data'
```

查看卷所在主机路径 / Locate the host volume:

```sh
docker volume inspect squirrel-kanban-data --format '{{ .Mountpoint }}'
```

Linux 上通常位于 Docker 数据目录的 `volumes/.../_data`；Docker Desktop
返回的是虚拟机内部路径。备份应通过容器读取卷，不依赖主机路径。
On Docker Desktop the mountpoint is inside its VM; use a container for backups.

## 运行边界 / Operational boundaries

- Use one application instance per SQLite data volume. Separate instances require distinct volume names and host ports.
- Keep `.env` available: Compose requires the initial-password variable on each configuration parse; the application only uses it when initializing an empty database.
- Existing database migrations preserve board content and fixed sharing links. Back up before upgrading.
- Preview services are optional. Only enable them if Office preview is needed, and test real documents in the target environment.
- Root filesystem is read-only; uploads and preview files must remain under the data directory or bounded `/tmp`.
- CI cleanup uses disposable volumes. Never copy `docker compose down -v` into a production update procedure.
