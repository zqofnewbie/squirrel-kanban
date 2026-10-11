# Contributing

目标：保持轻量，优先修复交互和正确性；新增依赖或后台服务需要解释必要性。

开发环境和启动步骤见 README（中文）或 README.en.md（English）。

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

发布前必须由项目所有者确定 LICENSE，并确认字体、图标、图片等第三方资产的授权和声明。没有 LICENSE 时，不应宣称仓库已经完成开源授权。
