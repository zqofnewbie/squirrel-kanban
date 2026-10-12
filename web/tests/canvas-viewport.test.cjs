const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync(require.resolve('../src/canvasViewport.ts'), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
const context={exports:{}};vm.runInNewContext(code,context)
function setup(x=48,y=48) {
  const el={clientWidth:1000,clientHeight:576,get scrollLeft(){return x},set scrollLeft(v){x=Math.max(0,v)},get scrollTop(){return y},set scrollTop(v){y=Math.max(0,v)}}
  const anchor=context.exports.createViewportAnchor(el)
  const resize=(w,h)=>{el.clientWidth=w;el.clientHeight=h;anchor.track();anchor.resize();anchor.track()}
  return {el,anchor,resize}
}
test('fullscreen edge clamping does not shift the canvas after repeated round trips',()=>{
 const {el,resize}=setup()
 for(let i=0;i<5;i++){resize(1280,720);assert.equal(el.scrollLeft,0);assert.equal(el.scrollTop,0);resize(1000,576);assert.equal(el.scrollLeft,48);assert.equal(el.scrollTop,48)}
})
test('a panned canvas keeps the same center across multiple browser resize steps',()=>{
 const {el,resize}=setup(300,200)
 resize(1280,576);resize(1280,720);assert.equal(el.scrollLeft+640,800);assert.equal(el.scrollTop+360,488)
 resize(1000,576);assert.equal(el.scrollLeft,300);assert.equal(el.scrollTop,200)
})
test('panning inside fullscreen replaces the anchor rather than restoring a stale position',()=>{
 const {el,anchor,resize}=setup();resize(1280,720);el.scrollLeft=220;el.scrollTop=80;anchor.track();resize(1000,576);assert.equal(el.scrollLeft,360);assert.equal(el.scrollTop,152)
})
test('hidden zero-size viewports do not overwrite the saved center',()=>{
 const {el,resize}=setup();resize(0,0);resize(1000,576);assert.equal(el.scrollLeft,48);assert.equal(el.scrollTop,48)
})
