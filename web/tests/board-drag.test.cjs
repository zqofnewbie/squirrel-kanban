const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const vm=require('node:vm')
const ts=require('typescript')
const code=ts.transpileModule(fs.readFileSync(require.resolve('../src/boardDrag.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
const context={exports:{},require};vm.runInNewContext(code,context)
const {moveBoardCard}=context.exports
const card=(id,column_id,pinned=false)=>({id,column_id,pinned})
const board=()=>({id:1,columns:[{id:1,cards:[card(1,1,true),card(2,1),card(3,1)]},{id:2,cards:[]}]})
test('same-list move changes order without mutating the original board',()=>{const b=board(),next=moveBoardCard(b,3,1,1);assert.equal(next.columns[0].cards.map(c=>c.id).join(','),'1,3,2');assert.equal(b.columns[0].cards.map(c=>c.id).join(','),'1,2,3')})
test('cross-list move into an empty column preserves one copy and updates ownership',()=>{const next=moveBoardCard(board(),2,2,50);assert.equal(next.columns[0].cards.map(c=>c.id).join(','),'1,3');assert.equal(next.columns[1].cards[0].column_id,2);assert.equal(next.columns.flatMap(c=>c.cards).filter(c=>c.id===2).length,1)})
test('pinned cards stay above ordinary cards and invalid targets are no-ops',()=>{const b=board();assert.equal(moveBoardCard(b,3,1,0).columns[0].cards[0].id,1);assert.equal(moveBoardCard(b,3,99,0),b);assert.equal(moveBoardCard(b,99,1,0),b)})
