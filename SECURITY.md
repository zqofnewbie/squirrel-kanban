# Security

目前项目尚未发布稳定版本，安全修复以主分支为准。不要在公开 Issue 中提交密码、分享链接密钥、数据库、附件或可直接利用的漏洞细节。

请通过 [GitHub 私密漏洞报告](https://github.com/zqofnewbie/squirrel-kanban/security/advisories/new)（**Security → Report a vulnerability**）联系维护者，此入口已启用。GitHub 和 Gitee 的公开 Issue 均不用于提交漏洞细节。

Please use [GitHub private vulnerability reporting](https://github.com/zqofnewbie/squirrel-kanban/security/advisories/new) for security issues. Do not post exploit details or credentials in public issues on either platform.

报告应包含受影响版本、最小复现步骤、影响范围和必要的脱敏日志。当前未承诺固定响应时限。

部署要求：

- 初次生产启动必须设置 12–72 字节的随机管理员密码；`.env` 不进入版本控制。
- 对外访问使用 HTTPS 反向代理；默认 Compose 监听 `0.0.0.0:${KANBAN_PORT:-8080}`，请通过防火墙限制直接访问，或在部署覆盖文件中改为 `127.0.0.1`。代理需覆盖而非透传客户端提交的转发头。
- 分享链接相当于访问凭证，按最少权限、适当有效期发放，失效后及时停用。
- SQLite 数据库、附件和备份均为私有数据；停止写入后一起备份，不要只复制活动中的数据库主文件。
- 不在公共环境启用 dev 模式，不挂载 Docker socket，不为应用增加容器特权。
- 更新基础镜像和依赖后运行测试及容器冒烟检查；安全扫描结果需要结合实际可达路径判断。

这份说明不是完整安全审计或无漏洞保证。

## Authentication / 认证

首次改密由服务端强制执行；初始会话只允许读取自身信息、改密和退出。
用户修改密码会撤销其他登录会话，当前会话保留。后台重置密码会撤销该用户会话。
登录每个直连 IP 每分钟最多 10 次，限流状态仅保存在进程内，重启会清空。
反向代理后的客户端共享代理 IP 的额度；公网部署应在代理层增加按客户端 IP 的限流。
不信任客户端自报的 `X-Forwarded-For`，避免伪造地址绕过限制。

Initial-password changes are enforced by the API. A password change revokes other
sessions. Login permits ten attempts per direct peer IP per minute, in bounded
process memory. Behind a proxy this is a shared quota: apply per-client limits at
the trusted reverse proxy as well. Restarting clears the in-process counters.

## Previously committed secrets / 历史凭据

发现历史凭据时，先在对应系统轮换密码或密钥，再清理 Git 历史。
删除当前文件或添加 ignore 不会删除历史。历史重写必须协调所有贡献者，
旧克隆、分支、镜像、缓存和派生仓库仍可能保留内容。
Rotate exposed credentials before coordinated history cleanup. Ignore rules do
not remove historical objects, and rewriting cannot recall forks or old clones.
