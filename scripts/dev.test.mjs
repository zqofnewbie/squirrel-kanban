import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { portOpen, readConfig, stopTree } from './dev.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const windows = process.platform === 'win32'

test('defaults, custom ports and data paths match on macOS and Windows', () => {
  assert.deepEqual(readConfig({}, '/project', 'darwin'), { apiPort: 8090, webPort: 5173, data: '/project/.dev' })
  assert.deepEqual(readConfig({}, 'C:\\project', 'win32'), { apiPort: 8090, webPort: 5173, data: 'C:\\project\\.dev' })
  assert.deepEqual(readConfig({}, '/project', 'linux'), { apiPort: 8090, webPort: 5173, data: '/project/.dev' })
  assert.equal(readConfig({ DEV_DATA_DIR: 'test data', API_PORT: '9090', WEB_PORT: '5174' }, '/project', 'darwin').data, '/project/test data')
  assert.equal(readConfig({ dev_data_dir: 'D:\\test data', api_port: '9090', web_port: '5174' }, 'C:\\project', 'win32').data, 'D:\\test data')
  for (const invalid of ['0', '65536', '-1', '5173;echo bad', '1.5', ' 8090']) {
    assert.throws(() => readConfig({ API_PORT: invalid }, '/project'), /API_PORT/)
  }
  assert.throws(() => readConfig({ API_PORT: '5173' }, '/project'), /不能相同/)
})

test('port check detects occupied loopback ports and releases its sockets', async () => {
  const server = net.createServer(socket => socket.destroy())
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  assert.equal(await portOpen(port), true)
  await new Promise(resolve => server.close(resolve))
  assert.equal(await portOpen(port), false)
})

test('both entry points invoke the same supervisor', async () => {
  assert.match(await readFile(path.join(root, 'dev.sh'), 'utf8'), /exec node scripts\/dev\.mjs/)
  assert.match(await readFile(path.join(root, 'dev.bat'), 'utf8'), /node scripts\\dev\.mjs/)
})

test('invalid settings fail before starting any services', { timeout: 5000 }, async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'API_PORT'))
  const child = spawn(process.execPath, [path.join(root, 'scripts/dev.mjs')], {
    env: { ...env, API_PORT: '65536' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const [code] = await once(child, 'exit')
  assert.equal(code, 1)
  assert.match(output, /API_PORT/)
  assert.doesNotMatch(output, /Ctrl\+C/)
})

// Tests a real process tree: stopping a launcher must also stop its child,
// rather than leave an API / compiler running in the background.
test('owned process tree stops without affecting an unrelated process', { timeout: 10000 }, async () => {
  const code = `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(child.pid); setInterval(()=>{},1000)`
  const owned = spawn(process.execPath, ['-e', code], { detached: !windows, stdio: ['ignore', 'pipe', 'ignore'] })
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: !windows, stdio: 'ignore' })
  const ownedExit = once(owned, 'exit')
  try {
    const [chunk] = await once(owned.stdout, 'data')
    const grandchildPid = Number(chunk.toString().trim())
    assert.ok(grandchildPid > 0)
    await stopTree(owned)
    await ownedExit
    const deadline = Date.now() + 2000
    let alive = true
    while (Date.now() < deadline) {
      try { process.kill(grandchildPid, 0) } catch { alive = false; break }
      await delay(50)
    }
    assert.equal(alive, false, 'grandchild must not remain running')
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0))
  } finally { await Promise.all([stopTree(owned), stopTree(unrelated)]) }
})

// Enable for native platform CI and local smoke checks after installing Go/npm.
test('real launcher starts, proxies API, retains data and cleans up Ctrl+C', { skip: process.env.DEV_SMOKE !== '1', timeout: 120000 }, async () => {
  async function freePort() {
    const server = net.createServer()
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    await new Promise(resolve => server.close(resolve))
    return port
  }
  const apiPort = await freePort()
  let webPort = await freePort()
  while (webPort === apiPort) webPort = await freePort()
  const data = await mkdtemp(path.join(os.tmpdir(), 'squirrel dev '))
  // Existing API/WEB settings must not leak into the fixture on Windows.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['API_PORT', 'WEB_PORT', 'DEV_DATA_DIR'].includes(key.toUpperCase())))
  const child = spawn(process.execPath, [path.join(root, 'scripts/dev.mjs')], {
    cwd: os.tmpdir(), env: { ...env, API_PORT: String(apiPort), WEB_PORT: String(webPort), DEV_DATA_DIR: data },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const exited = once(child, 'exit')
  try {
    const deadline = Date.now() + 90000
    while (!output.includes('Ctrl+C') && child.exitCode === null && Date.now() < deadline) await delay(100)
    assert.match(output, /Ctrl\+C/, output)
    const result = await fetch(`http://127.0.0.1:${webPort}/api/auth/me`)
    assert.equal(result.status, 401, 'Vite must proxy to the selected API port')
    assert.ok((await readFile(path.join(data, 'kanban.db'))).length > 0)
    // Windows process.kill(SIGINT) force-terminates a process; use a real console
    // Ctrl+C for that path. SIGTERM reaches the supervisor on POSIX.
    if (!windows) {
      child.kill('SIGINT')
      const [code] = await exited
      assert.equal(code, 0)
      assert.equal(await portOpen(apiPort), false)
      assert.equal(await portOpen(webPort), false)
      assert.ok((await readFile(path.join(data, 'kanban.db'))).length > 0)
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      if (windows) await stopTree(child)
      else { child.kill('SIGINT'); await exited }
    }
    await rm(data, { recursive: true, force: true })
  }
})
