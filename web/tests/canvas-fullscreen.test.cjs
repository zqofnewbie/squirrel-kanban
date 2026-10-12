const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync(require.resolve('../src/useCanvasFullscreen.ts'), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
function fixture({supported=true, denied=false, deferred=false}={}) {
  const classes = new Set(), listeners = new Map()
  let cleanup, resolve, exits=0
  const doc = {fullscreenEnabled:supported, fullscreenElement:null, documentElement:{classList:{toggle(k,v){v?classes.add(k):classes.delete(k)},remove(k){classes.delete(k)}}}, addEventListener(k,f){listeners.set(k,f)},removeEventListener(k){listeners.delete(k)},async exitFullscreen(){exits++;doc.fullscreenElement=null;listeners.get('fullscreenchange')?.()}}
  doc.documentElement.requestFullscreen = async () => {
    if(denied) throw new Error('Denied')
    if(deferred) await new Promise(r=>{resolve=r})
    doc.fullscreenElement=doc.documentElement
    listeners.get('fullscreenchange')?.()
  }
  const react={useRef:v=>({current:v}),useState:v=>[v,()=>{}],useEffect:f=>{cleanup=f()}}
  const context={exports:{},document:doc,require:()=>react};vm.runInNewContext(code,context)
  const api=context.exports.useCanvasFullscreen()
  return {api,doc,classes,cleanup:()=>cleanup(),resolve:()=>resolve(),exits:()=>exits,active:()=>classes.has('canvas-fullscreen')}
}
test('native fullscreen includes the document and clears state on browser exit',async()=>{
 const f=fixture();await f.api.toggle();assert.equal(f.doc.fullscreenElement,f.doc.documentElement);assert.ok(f.active());await f.doc.exitFullscreen();assert.equal(f.active(),false);f.cleanup()
})
test('unsupported and rejected native fullscreen fall back to page mode',async()=>{
 for(const options of [{supported:false},{denied:true}]) {const f=fixture(options);await f.api.toggle();assert.ok(f.active());assert.equal(f.doc.fullscreenElement,null);await f.api.exit();assert.equal(f.active(),false);f.cleanup()}
})
test('a second click during native entry cancels without leaving browser fullscreen',async()=>{
 const f=fixture({deferred:true});const pending=f.api.toggle();await f.api.toggle();f.resolve();await pending;assert.equal(f.active(),false);assert.equal(f.doc.fullscreenElement,null);f.cleanup()
})
test('navigation during a pending request cannot leak fullscreen into the next screen',async()=>{
 const f=fixture({deferred:true});const pending=f.api.toggle();f.cleanup();f.resolve();await pending;assert.equal(f.active(),false);assert.equal(f.doc.fullscreenElement,null)
})
test('unmount exits owned fullscreen but leaves externally entered fullscreen alone',async()=>{
 const f=fixture();await f.api.toggle();f.cleanup();assert.equal(f.doc.fullscreenElement,null)
 const external=fixture();external.doc.fullscreenElement=external.doc.documentElement;await external.api.toggle();await external.api.exit();external.cleanup();assert.equal(external.exits(),0)
})
