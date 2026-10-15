// Shared macOS / Linux / Windows development launcher. No extra dependencies.
import { spawn } from 'node:child_process'
import { access, mkdir, realpath, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const windows = process.platform === 'win32'

export function readConfig(env, projectRoot, platform = process.platform) {
  const value = name => env[Object.keys(env).find(key => platform === 'win32' ? key.toUpperCase() === name : key === name)]
  const port = (name, fallback) => {
    const raw = value(name) || String(fallback)
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) throw new Error(`${name} 必须是 1–65535 的整数端口。`)
    return Number(raw)
  }
  const apiPort = port('API_PORT', 8090)
  const webPort = port('WEB_PORT', 5173)
  if (apiPort === webPort) throw new Error('API_PORT 与 WEB_PORT 不能相同。')
  const paths = platform === 'win32' ? path.win32 : path
  return { apiPort, webPort, data: paths.resolve(projectRoot, value('DEV_DATA_DIR') || '.dev') }
}

export function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const finish = open => { socket.destroy(); resolve(open) }
    socket.setTimeout(500)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}

async function executable(name) {
  const searchPath = process.env.PATH || process.env.Path || ''
  for (const dir of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const suffix of windows ? ['.exe', '.cmd', '.bat', ''] : ['']) {
      const candidate = path.join(dir.replace(/^"|"$/g, ''), name + suffix)
      try { await access(candidate, constants.X_OK); return candidate } catch { /* next PATH entry */ }
    }
  }
  return null
}

// POSIX children have their own process group. Windows taskkill removes the
// complete owned tree, including Air's server, without killing by name.
export async function stopTree(child) {
  if (!child.pid) return
  if (windows) {
    await new Promise(resolve => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.once('error', resolve); killer.once('exit', resolve)
    })
    return
  }
  try { process.kill(-child.pid, 'SIGTERM') } catch (e) { if (e.code !== 'ESRCH') throw e }
  const deadline = Date.now() + 2500
  while (Date.now() < deadline) {
    try { process.kill(-child.pid, 0) } catch { return }
    await delay(50)
  }
  try { process.kill(-child.pid, 'SIGKILL') } catch (e) { if (e.code !== 'ESRCH') throw e }
}

export async function main() {
  const children = new Set()
  let stopping = false
  let shutdownPromise
  const shutdown = code => {
    if (shutdownPromise) return shutdownPromise
    stopping = true
    process.exitCode = code
    shutdownPromise = Promise.all([...children].map(stopTree))
    return shutdownPromise
  }
  const onInterrupt = () => { void shutdown(0) }
  const onTerminate = () => { void shutdown(143) }
  process.on('SIGINT', onInterrupt)
  process.on('SIGTERM', onTerminate)
  if (windows) process.on('SIGHUP', onTerminate)
  function start(command, args, cwd, env, label, service = false) {
    if (stopping) throw new Error('启动已取消。')
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', detached: !windows, windowsHide: true })
    children.add(child)
    const done = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal }))
    })
    if (service) void done.then(result => {
      if (!stopping) { console.error(`[${label}] 已退出 (${result.signal || result.code})，正在停止另一服务。`); void shutdown(1) }
    }, error => { console.error(`[${label}] ${error.message}`); void shutdown(1) })
    return { child, done }
  }
  async function run(command, args, cwd, env, label) {
    const job = start(command, args, cwd, env, label)
    const result = await job.done
    children.delete(job.child)
    if (stopping) throw new Error('启动已取消。')
    if (result.code !== 0) throw new Error(`${label} 失败 (${result.signal || result.code})。`)
  }
  try {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('请安装 Node.js 22+。')
    const config = readConfig(process.env, root)
    const go = await executable('go')
    if (!go) throw new Error('请安装 Go 1.26+ 并加入 PATH。')
    if (!await executable('npm')) throw new Error('请安装 npm 并加入 PATH。')
    for (const port of [config.apiPort, config.webPort]) {
      if (await portOpen(port)) throw new Error(`端口 ${port} 已占用，请通过 API_PORT / WEB_PORT 换端口。`)
    }
    const env = { ...process.env, GOTOOLCHAIN: 'local', KANBAN_DEV: '1', KANBAN_API: `http://127.0.0.1:${config.apiPort}`, KANBAN_ADDR: `127.0.0.1:${config.apiPort}`, KANBAN_DATA: config.data }
    await Promise.all([config.data, path.join(root, '.dev'), path.join(root, 'server/static')].map(dir => mkdir(dir, { recursive: true })))
    await writeFile(path.join(root, 'server/static/.gitkeep'), '', { flag: 'a' })
    const webRoot = path.join(root, 'web')
    const vite = path.join(webRoot, 'node_modules/vite/bin/vite.js')
    try { await access(vite) } catch {
      console.log('正在安装前端依赖…')
      // Only a constant command passes through cmd.exe. User-supplied paths
      // and ports are passed separately, never interpolated into shell text.
      if (windows) await run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ci --no-audit --no-fund'], webRoot, env, 'npm ci')
      else await run('npm', ['ci', '--no-audit', '--no-fund'], webRoot, env, 'npm ci')
    }
    const serverRoot = path.join(root, 'server')
    const air = await executable('air')
    if (air) {
      console.log('[API] 使用 Air 热重载。')
      start(air, [], serverRoot, env, 'Air', true)
    } else {
      console.log('[API] 正在编译 Go 后端；修改 Go 代码后需重启。')
      const binary = path.join(root, '.dev', windows ? 'squirrel-dev.exe' : 'squirrel-dev')
      await run(go, ['build', '-o', binary, '.'], serverRoot, env, 'Go build')
      start(binary, [], serverRoot, env, 'API', true)
    }
    start(process.execPath, [vite, '--port', String(config.webPort), '--strictPort'], webRoot, env, 'Vite', true)
    const deadline = Date.now() + 90000
    let ready = false
    while (!stopping && Date.now() < deadline) {
      try {
        const responses = await Promise.all([`http://127.0.0.1:${config.apiPort}/healthz`, `http://127.0.0.1:${config.webPort}/`].map(url => fetch(url, { signal: AbortSignal.timeout(1000), redirect: 'error' })))
        await Promise.all(responses.map(response => response.body?.cancel()))
        if (responses.every(response => response.ok)) { ready = true; break }
      } catch { /* services still starting */ }
      await delay(250)
    }
    if (!stopping && !ready) throw new Error('服务在 90 秒内未就绪，请检查上方日志。')
    if (!stopping) console.log(`松鼠看板已就绪 → http://127.0.0.1:${config.webPort}\n数据目录: ${config.data}\nCtrl+C 停止本次启动的两个服务。`)
    while (!stopping) await delay(250)
  } catch (e) {
    if (!stopping) console.error(`[dev] ${e.message}`)
    await shutdown(stopping ? process.exitCode : 1)
  } finally {
    await shutdownPromise
    process.off('SIGINT', onInterrupt)
    process.off('SIGTERM', onTerminate)
    if (windows) process.off('SIGHUP', onTerminate)
  }
}

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
