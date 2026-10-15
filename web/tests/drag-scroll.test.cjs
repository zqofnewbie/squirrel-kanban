const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
const code = ts.transpileModule(
  fs.readFileSync(require.resolve('../src/BoardDragScroll.tsx'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText
function setup(running = true) {
  let monitor,
    effect,
    callback,
    measures = 0,
    cancelled = false
  const listeners = {}
  const area = { scrollTop: 500, getBoundingClientRect: () => ({ top: 100, bottom: 600 }) }
  const column = {
    getBoundingClientRect: () => ({ left: 0, right: 300, top: 80, bottom: 640 }),
    querySelector: () => area,
  }
  const context = {
    exports: {},
    innerHeight: 900,
    document: { querySelectorAll: () => [column], querySelector: () => null },
    window: {
      addEventListener: (n, f) => (listeners[n] = f),
      removeEventListener: (n) => delete listeners[n],
    },
    requestAnimationFrame: (f) => {
      callback = f
      return 1
    },
    cancelAnimationFrame: () => (cancelled = true),
    require: (name) =>
      name === 'react'
        ? {
            useRef: (v) => ({ current: v }),
            useState: () => [running, () => {}],
            useEffect: (f) => (effect = f),
          }
        : {
            useDndMonitor: (m) => (monitor = m),
            useDndContext: () => ({ measureDroppableContainers: () => measures++ }),
          },
  }
  vm.runInNewContext(code, context)
  context.exports.default()
  const cleanup = effect()
  return {
    area,
    start: (y, type = 'card') =>
      monitor.onDragStart({
        activatorEvent: { clientX: 100, clientY: y },
        active: { data: { current: { type } } },
      }),
    move: (y) => listeners.pointermove({ clientX: 100, clientY: y }),
    tick: (t) => callback?.(t),
    end: () => monitor.onDragEnd(),
    cancel: () => monitor.onDragCancel(),
    cleanup: () => cleanup?.(),
    measures: () => measures,
    cancelled: () => cancelled,
    hasFrame: () => !!callback,
  }
}
test('edge scrolling reverses immediately and remeasures drop targets', () => {
  const f = setup()
  f.start(596)
  f.tick(100)
  f.tick(116)
  assert.ok(f.area.scrollTop > 500)
  const bottom = f.area.scrollTop
  f.move(104)
  f.tick(132)
  assert.ok(f.area.scrollTop < bottom)
  assert.equal(f.measures(), 2)
  f.move(350)
  const middle = f.area.scrollTop
  f.tick(148)
  assert.equal(f.area.scrollTop, middle)
  f.cleanup()
  assert.ok(f.cancelled())
})
test('dropping and cancelling stop scroll without a trailing movement', () => {
  for (const finish of ['end', 'cancel']) {
    const f = setup()
    f.start(596)
    f.tick(100)
    f.tick(116)
    f[finish]()
    const top = f.area.scrollTop
    f.tick(132)
    assert.equal(f.area.scrollTop, top)
    f.cleanup()
  }
})
test('idle board does not schedule animation frames', () => {
  assert.equal(setup(false).hasFrame(), false)
})
test('column dragging does not scroll the cards inside a column', () => {
  const f = setup()
  f.start(596, 'column')
  f.tick(100)
  f.tick(116)
  assert.equal(f.area.scrollTop, 500)
  f.cleanup()
})
