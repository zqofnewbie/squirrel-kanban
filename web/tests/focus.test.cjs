const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync(require.resolve('../src/focus.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
function setup() {
  const handlers = {},
    document = { activeElement: null, body: {}, documentElement: { dataset: {} } }
  const context = {
    exports: {},
    document,
    window: { addEventListener: (name, fn) => (handlers[name] = fn) },
  }
  vm.runInNewContext(code, context)
  function element(text = false, hidden = false) {
    const attrs = new Set(),
      events = {}
    return {
      isConnected: true,
      attrs,
      closest: () => hidden,
      matches: () => text,
      setAttribute: (k) => attrs.add(k),
      removeAttribute: (k) => attrs.delete(k),
      addEventListener: (n, f) => (events[n] = f),
      removeEventListener: (n) => delete events[n],
      focus(options) {
        this.options = options
        document.activeElement = this
      },
      blur() {
        events.blur?.()
      },
    }
  }
  return { ...context.exports, handlers, element, document }
}
test('pointer restoration suppresses ring, prevents scrolling and clears on keyboard input', () => {
  const f = setup(),
    el = f.element()
  f.handlers.pointerdown()
  f.focusElement(el)
  assert.ok(el.attrs.has('data-pointer-focus-restored'))
  assert.equal(el.options.preventScroll, true)
  f.handlers.keydown({ key: 'Tab' })
  assert.equal(el.attrs.size, 0)
  assert.equal(f.keyboardFocus(), true)
})
test('keyboard restoration is visible and the next pointer interaction clears it', () => {
  const f = setup(),
    el = f.element()
  f.handlers.keydown({ key: 'Enter' })
  f.focusElement(el)
  assert.ok(el.attrs.has('data-keyboard-focus-restored'))
  f.handlers.pointerdown()
  assert.equal(el.attrs.size, 0)
})
test('switching restored targets clears old attributes; blur leaves no marker', () => {
  const f = setup(),
    a = f.element(),
    b = f.element()
  f.focusElement(a, false)
  f.focusElement(b, true)
  assert.equal(a.attrs.size, 0)
  b.blur()
  assert.equal(b.attrs.size, 0)
})
test('text inputs do not get a forced outline and hidden targets do not steal focus', () => {
  const f = setup(),
    input = f.element(true),
    hidden = f.element(false, true)
  f.focusElement(input, true)
  assert.equal(input.attrs.size, 0)
  f.focusElement(hidden)
  assert.equal(hidden.options, undefined)
})

test('pointer pickup overrides prior keyboard modality; keyboard navigation restores it', () => {
  const f = setup()
  f.handlers.keydown({ key: 'Escape' })
  assert.equal(f.document.documentElement.dataset.focusModality, 'keyboard')
  f.handlers.pointerdown()
  assert.equal(f.document.documentElement.dataset.focusModality, 'pointer')
  f.handlers.keydown({ key: 'Shift' })
  assert.equal(f.document.documentElement.dataset.focusModality, 'pointer')
  f.handlers.keydown({ key: 'Tab' })
  assert.equal(f.document.documentElement.dataset.focusModality, 'keyboard')
})
