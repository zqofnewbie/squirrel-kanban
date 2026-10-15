# Contributing

目标：保持轻量，优先修复交互和正确性；新增依赖或后台服务需要解释必要性。

开发环境和启动步骤见 README（中文）或 README.en.md（English）。

`dev.sh` / `dev.bat` 仅作为入口，共用 `scripts/dev.mjs`。修改启动逻辑后执行 `node --test scripts/dev.test.mjs`；安装 Go 和前端依赖后，以 `DEV_SMOKE=1 node --test scripts/dev.test.mjs` 实测独立端口 / 临时数据、API 代理和退出清理（PowerShell 使用 `$env:DEV_SMOKE="1"`）。Windows 的 Ctrl+C 需在原生终端验证，自动测试覆盖启动和进程树清理；CI 对三种操作系统运行轻量检查。

手动开发启动：`cd server && go run . -dev -addr 127.0.0.1:8090 -data ../.dev`；另开终端执行 `cd web && npm ci && npm run dev`。提交前执行：

```sh
cd web
npm ci
npm test
npm run build
cd ../server
go test ./...
go vet ./...
```

涉及权限时覆盖超级管理员、子管理员、成员与分享访客；涉及 UI 时检查中文、英文、明暗主题和键盘操作。修改数据库需保留现有数据，提供迁移测试。

PR 描述写明问题、改动和验证结果。禁止提交真实账号、分享凭证、数据库、附件、`.env`、浏览器快照或生产日志。

Docker 修改需执行两套 Compose 配置校验、构建、健康检查以及重启后数据保留测试。CI 使用独立临时数据卷；不要对真实部署执行 CI 的清理命令。

本项目采用 MIT。新增第三方资产需保留其许可及来源；不要将第三方许可改成 MIT。

## Formatting and optional browser tests

Run `npm run format:check` in `web`; use `npm run format` before submitting changes.
Browser tests are optional development tools in `tests/browser`, never runtime
or normal dev-start dependencies. See [release checklist](docs/release-checklist.md).
Keep browser fixtures disposable. Do not point smoke tests at existing deployments.

Gitee hosts the source repository. `.github/workflows/ci.yml` runs only on GitHub
mirrors; Gitee users should execute the same release checks in their configured CI.
The workflow includes native startup smoke tests on Linux, macOS and Windows.
