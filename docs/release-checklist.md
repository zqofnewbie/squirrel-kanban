# 发布回归 / Release checklist

保持轻量：浏览器工具仅用于可选回归，不进入应用依赖、启动流程或 Docker 镜像。
Browser tooling is optional and excluded from normal development startup and production.

## Automated checks / 自动检查

Node.js 22.12+ and Go 1.26+ are required locally; CI uses the versions pinned in
its workflow. Run from the repository root:

```sh
npm --prefix web ci
npm --prefix web run format:check
npm --prefix web test
npm --prefix web run build
cd server
go test ./...
go vet ./...
cd ..
DEV_SMOKE=1 node --test scripts/dev.test.mjs
```

PowerShell: `$env:DEV_SMOKE='1'; node --test scripts/dev.test.mjs`.
The startup smoke uses temporary data and free ports. Never clear `.dev` for a test.

## Optional browser regression / 可选浏览器回归

```sh
cd server
go build -o ../squirrel-test-server .
cd ../tests/browser
npm ci
npx playwright install chromium
KANBAN_TEST_BINARY="$PWD/../../squirrel-test-server" npm test
```

Windows: build `squirrel-test-server.exe` and set `$env:KANBAN_TEST_BINARY` to its
absolute path. `CHROME_PATH` can select an existing Chrome executable instead of
downloading Chromium. The test starts a private loopback server, creates random
credentials in a temporary data directory, and removes it when finished. It
covers all roles, both languages/themes, menu bounds, fullscreen, draft discard,
role entry visibility, and API authorization. It does not accept a production URL.

## Deployment / 部署

Use a dedicated Compose project, unused host port and new `KANBAN_VOLUME`.
Validate both base and preview configurations, build, wait for health, verify
non-root execution, read-only root, restart persistence, backup and restore.
With the optional preview service, upload and preview a real DOCX and PDF.
See [deployment guide](deployment.md). Do not run `down -v` on real data.

## Manual release checks / 手工发布检查

- Native Windows and macOS: start, stop, Ctrl/Cmd shortcuts, fonts, pinch/pan.
- Large boards: same/cross-column drag, empty columns, pinned cards, Esc cancel,
  top/bottom autoscroll and screenshots including offscreen cards.
- Menus: rightmost and bottom cards, hover bridge, keyboard navigation, fullscreen.
- Role changes: assignment, ownership transfer, revocation, disabled/expired shares.
- Slow/offline connection: loading, retry, preserved input, no false success.

CI startup smoke covers Linux/macOS/Windows; this is not a substitute for native
visual/gesture checks. `.github/workflows/ci.yml` runs on the GitHub repository; Gitee mirrors the source.
For Gitee, run these commands in the project's chosen CI runner; no Gitee runner
or external credential is configured by this repository.

## Publication / 公开发布

- MIT `LICENSE`, bilingual README, notices and screenshots are present.
- No private data or secrets in the working tree **or Git history**.
- Rotate any previously exposed credentials, coordinate history rewriting and
  retire old clones/mirrors. History cleanup alone is not credential rotation.
- Record actual checks and limitations in [deployment review](deployment-review.md).

CI exports a CycloneDX frontend SBOM, Go module list, image metadata and commit ID.
These are verification artifacts, not signed release images. Publishing/signing
requires the repository owner's chosen registry and credentials. Base image
manifests are pinned in `Dockerfile`; update the digest together with its tag and
rerun verification. The optional Office CI step converts the generated
`tests/fixtures/preview.doc` through the real Gotenberg service and checks PDF output.
