# 部署、备份与恢复 / Deployment, backup and restore

部署入口见 [中文 README](../README.md) / [English README](../README.en.md)。所有命令在项目根目录执行。

## 配置 / Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
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

```sh
docker compose down
docker volume create squirrel-kanban-data
docker run --rm -i -u 0 --entrypoint sh \
  -v squirrel-kanban-data:/data alpine:3.24.2 \
  -c 'tar -xzf - -C /data && chown -R 10001:10001 /data' < backups/YOUR-BACKUP.tar.gz
docker compose up -d --build --wait
```

## 旧目录迁移 / Migrate an existing bind mount

旧的 `./data:/data` 不会自动迁移。停止旧服务并备份后复制整个目录到空命名卷。

An old `./data:/data` bind mount is not migrated automatically. Stop and back up the old deployment, then copy all files into an empty named volume.

```sh
docker compose down
mkdir -p backups
cp -R data backups/data-before-migration
docker volume create squirrel-kanban-data
docker run --rm -u 0 --entrypoint sh \
  -v "$PWD/data:/old:ro" -v squirrel-kanban-data:/data \
  alpine:3.24.2 -c 'cp -a /old/. /data/ && chown -R 10001:10001 /data'
docker compose up -d --build --wait
```

## 运行边界 / Operational boundaries

- Use one application instance per SQLite data volume. Separate instances require distinct volume names and host ports.
- Keep `.env` available: Compose requires the initial-password variable on each configuration parse; the application only uses it when initializing an empty database.
- Existing database migrations preserve board content and fixed sharing links. Back up before upgrading.
- Preview services are optional. Only enable them if Office preview is needed, and test real documents in the target environment.
- Root filesystem is read-only; uploads and preview files must remain under the data directory or bounded `/tmp`.
- CI cleanup uses disposable volumes. Never copy `docker compose down -v` into a production update procedure.
