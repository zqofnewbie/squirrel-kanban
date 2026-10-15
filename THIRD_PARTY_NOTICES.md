# Third-party notices / 第三方声明

The project code is MIT licensed; third-party components keep their original
licenses. MIT does not replace the licenses of dependencies, fonts or containers.
项目代码采用 MIT，第三方组件仍遵循其原有许可证。

- **Noto Sans SC**: SIL Open Font License 1.1. Font source and full license are
  included in [SOURCE.md](web/public/fonts/SOURCE.md) and [OFL.txt](web/public/fonts/OFL.txt).
- **Squirrel mascot**: generated with imagegen for this project; see
  [generation record](docs/logo-prompt.md). No third-party mascot trademark is claimed.
- **Icons and preset backgrounds**: maintained in the project source. New external
  assets must include their origin and license before being accepted.
- **Morphicons 1.7.1**: MIT, by Guillermo López. Used only for state-changing UI icons;
  [upstream source](https://github.com/guillermolg00/morphicons). Existing project paths
  are reused without an additional icon catalog. Full license is in the inventory below.
- **JavaScript and Go dependencies**: see [dependency license texts](docs/dependency-licenses.txt),
  generated from installed packages and the Go module cache. Lockfiles identify
  exact versions. Regenerate notices when dependencies change.
- **Docker images**: Node.js and Go are build stages; Alpine is the runtime base.
  Optional Gotenberg/LibreOffice runs as a separate service and has its own
  component licenses. Retain upstream notices when distributing container images.

Use `node scripts/dependency-notices.mjs` after installing frontend dependencies
and running `go mod download` in `server`. Missing license texts are reported;
review such packages before distributing a release.
