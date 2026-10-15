const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync(require.resolve('../src/store.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
function load(api) {
  const context = {
    exports: {},
    require(name) {
      if (name === 'zustand') return require('zustand')
      if (name === './api') return { api }
      if (name === './i18n')
        return { t: (s) => s, preference: () => null, detectTheme: () => 'light' }
      if (name === './boardDrag') return {}
      throw Error(name)
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: { getItem: () => null, setItem() {} },
    location: { pathname: '/' },
    history: { pushState() {} },
    document: { documentElement: { classList: { toggle() {} } } },
  }
  vm.runInNewContext(code, context)
  return context.exports.useStore
}
for (const role of ['member', 'workspace_admin'])
  test(`${role}: successful login without spaces clears a previous authentication error`, async () => {
    const store = load({
      login: async () => ({ user: { id: 2, role }, actor: 'test' }),
      workspaces: async () => [],
    })
    store.setState({
      error: '用户名或密码不正确',
      boards: [{ id: 1 }],
      board: { id: 1 },
      workspaceId: 1,
    })
    await store.getState().login('test', 'test-password')
    assert.equal(store.getState().me.role, role)
    assert.equal(store.getState().error, null)
    assert.equal(store.getState().workspaceId, null)
    assert.equal(store.getState().board, null)
    assert.equal(store.getState().boards.length, 0)
    assert.equal(store.getState().loading, false)
  })
test('workspace fetch failure stops loading and a successful empty retry clears the error', async () => {
  let fail = true
  const store = load({
    workspaces: async () => {
      if (fail) throw Error('network unavailable')
      return []
    },
  })
  await store.getState().loadWorkspaces()
  assert.equal(store.getState().loading, false)
  assert.equal(store.getState().error, 'network unavailable')
  fail = false
  await store.getState().loadWorkspaces()
  assert.equal(store.getState().error, null)
  assert.equal(store.getState().loading, false)
})
test('logout and expired sessions discard errors from the previous account', async () => {
  const store = load({ logout: async () => {} })
  store.setState({ error: 'old account error', loading: true })
  await store.getState().logout()
  assert.equal(store.getState().error, null)
  assert.equal(store.getState().loading, false)
  store.setState({ error: 'old account error' })
  store.getState().expireSession()
  assert.equal(store.getState().error, null)
})
