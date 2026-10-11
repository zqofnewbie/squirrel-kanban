const test = require('node:test')
const assert = require('node:assert/strict')
const lock = require('../package-lock.json')

for (const name of ['rollup', 'esbuild']) {
  test(`${name} locks supported desktop and Docker binaries at the required version`, () => {
    const parent = `node_modules/${name}`
    for (const [dependency, version] of Object.entries(lock.packages[parent].optionalDependencies)) {
      if (!/^@(rollup|esbuild)\/(rollup-)?(darwin|win32|linux)-(x64|arm64)(-|$)/.test(dependency)) continue
      const entry = lock.packages[`${parent}/node_modules/${dependency}`] || lock.packages[`node_modules/${dependency}`]
      assert.ok(entry, `Missing ${dependency}; repair the lockfile in a clean directory`)
      assert.equal(entry.version, version, dependency)
    }
  })
}
