const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync(require.resolve('../src/boardDrag.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const context = { exports: {}, require }
vm.runInNewContext(code, context)
const { moveBoardCard } = context.exports
const card = (id, column_id, pinned = false) => ({ id, column_id, pinned })
const board = () => ({
  id: 1,
  columns: [
    { id: 1, cards: [card(1, 1, true), card(2, 1), card(3, 1)] },
    { id: 2, cards: [] },
  ],
})
test('same-list move changes order without mutating the original board', () => {
  const b = board(),
    next = moveBoardCard(b, 3, 1, 1)
  assert.equal(next.columns[0].cards.map((c) => c.id).join(','), '1,3,2')
  assert.equal(b.columns[0].cards.map((c) => c.id).join(','), '1,2,3')
})
test('cross-list move into an empty column preserves one copy and updates ownership', () => {
  const next = moveBoardCard(board(), 2, 2, 50)
  assert.equal(next.columns[0].cards.map((c) => c.id).join(','), '1,3')
  assert.equal(next.columns[1].cards[0].column_id, 2)
  assert.equal(next.columns.flatMap((c) => c.cards).filter((c) => c.id === 2).length, 1)
})
test('pinned cards stay above ordinary cards and invalid targets are no-ops', () => {
  const b = board()
  assert.equal(moveBoardCard(b, 3, 1, 0).columns[0].cards[0].id, 1)
  assert.equal(moveBoardCard(b, 3, 99, 0), b)
  assert.equal(moveBoardCard(b, 99, 1, 0), b)
})

test('pointer collision follows the visible pointer instead of the scrolling source centre', () => {
  const { boardCollision } = context.exports
  const rect = (top, height) => ({
    top,
    bottom: top + height,
    left: 0,
    right: 100,
    width: 100,
    height,
  })
  const containers = [
    { id: 'col:1', data: { current: { type: 'column' } } },
    { id: 1, data: { current: { type: 'card', columnId: 1 } } },
    { id: 2, data: { current: { type: 'card', columnId: 1 } } },
  ]
  const args = {
    active: { data: { current: { type: 'card' } } },
    droppableContainers: containers,
    droppableRects: new Map([
      ['col:1', rect(0, 500)],
      [1, rect(0, 80)],
      [2, rect(200, 80)],
    ]),
    collisionRect: rect(0, 80),
    pointerCoordinates: { x: 50, y: 240 },
  }
  assert.equal(boardCollision(args)[0].id, 2)
  assert.equal(boardCollision({ ...args, pointerCoordinates: null })[0].id, 1)
})

test('cancel restores the original slot after visiting multiple columns, preserving live edits', () => {
  const { restoreBoardCard } = context.exports
  const original = board()
  original.columns.push({ id: 3, cards: [] })
  let moved = moveBoardCard(moveBoardCard(original, 2, 2, 0), 2, 3, 0)
  moved.columns[0].cards[1] = { ...moved.columns[0].cards[1], title: 'live edit' }
  const restored = restoreBoardCard(moved, original, 2)
  assert.equal(restored.columns[0].cards.map((c) => c.id).join(','), '1,2,3')
  assert.equal(restored.columns[0].cards[2].title, 'live edit')
  assert.equal(restored.columns[1].cards.length + restored.columns[2].cards.length, 0)
})
test('cancel does not resurrect a deleted card or overwrite another board', () => {
  const { restoreBoardCard } = context.exports,
    original = board(),
    other = { ...board(), id: 99 }
  assert.equal(restoreBoardCard(other, original, 2), other)
  const deleted = {
    ...board(),
    columns: [
      { id: 1, cards: [card(1, 1, true), card(3, 1)] },
      { id: 2, cards: [] },
    ],
  }
  assert.equal(restoreBoardCard(deleted, original, 2), deleted)
})
test('collision keeps pinned and ordinary previews in their own sorting group, including empty columns', () => {
  const { boardCollision } = context.exports
  const rect = (top, height) => ({
    top,
    bottom: top + height,
    left: 0,
    right: 100,
    width: 100,
    height,
  })
  const containers = [
    { id: 'col:1', data: { current: { type: 'column' } } },
    { id: 1, data: { current: { type: 'card', columnId: 1, pinned: true } } },
    { id: 2, data: { current: { type: 'card', columnId: 1, pinned: false } } },
  ]
  const args = {
    active: { data: { current: { type: 'card', pinned: false } } },
    droppableContainers: containers,
    droppableRects: new Map([
      ['col:1', rect(0, 500)],
      [1, rect(0, 80)],
      [2, rect(200, 80)],
    ]),
    collisionRect: rect(0, 80),
    pointerCoordinates: { x: 50, y: 20 },
  }
  assert.equal(boardCollision(args)[0].id, 2)
  assert.equal(
    boardCollision({
      ...args,
      active: { data: { current: { type: 'card', pinned: true } } },
      pointerCoordinates: { x: 50, y: 240 },
    })[0].id,
    1,
  )
  assert.equal(
    boardCollision({ ...args, droppableContainers: containers.slice(0, 1) })[0].id,
    'col:1',
  )
})
test('persisted ordering uses the next card in the same pin group', () => {
  const { cardBeforeId } = context.exports
  const cards = [card(1, 1, true), card(2, 1, true), card(3, 1), card(4, 1)]
  assert.equal(cardBeforeId(cards, 1), 2)
  assert.equal(cardBeforeId(cards, 2), 0)
  assert.equal(cardBeforeId(cards, 3), 4)
  assert.equal(cardBeforeId(cards, 4), 0)
})
