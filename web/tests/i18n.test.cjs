const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const path = require('node:path')
const root = path.resolve(__dirname, '../src')
const english = require('../src/en.json')
const code = ts.transpileModule(fs.readFileSync(path.join(root, 'i18n.ts'), 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText
function load(languages, saved = {}) {
 const context = {exports:{},require:()=>english,navigator:{languages,language:languages[0]},localStorage:{getItem:key=>saved[key]??null,setItem:(key,value)=>{saved[key]=value}},document:{documentElement:{}},location:{reload(){}}}
 vm.runInNewContext(code,context)
 return context.exports
}
test('browser language and explicit preference',()=>{
 assert.equal(load(['en-US','zh-CN']).language,'en')
 assert.equal(load(['zh-TW','en-US']).language,'zh')
 assert.equal(load(['en'],{'squirrel.language.v1':'zh'}).language,'zh')
 assert.equal(load(['zh'],{'squirrel.language.v1':'en'}).locale(),'en-US')
 assert.equal(load([]).language,'en')
})
test('system theme and explicit preference',()=>{
 const {detectTheme}=load(['en'])
 assert.equal(detectTheme(null,true),'dark')
 assert.equal(detectTheme(null,false),'light')
 assert.equal(detectTheme('light',true),'light')
 assert.equal(detectTheme('dark',false),'dark')
})
test('translation preserves user-provided content and placeholders',()=>{
 assert.equal(load(['en']).t('删除{0}',['中文项目']),'Delete 中文项目')
 assert.equal(load(['zh']).t('删除{0}',['English project']),'删除English project')
 for(const [source,target] of Object.entries(english)) {
  assert.deepEqual([...source.matchAll(/\{\d+\}/g)].map(x=>x[0]).sort(),[...target.matchAll(/\{\d+\}/g)].map(x=>x[0]).sort(),source)
  assert.ok(!/[\u3400-\u9fff]/.test(target),source)
 }
})
test('all literal UI translation keys have English translations',()=>{
 for(const file of fs.readdirSync(root).filter(f=>/\.tsx?$/.test(f))) {
  const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true)
  function visit(n) {
   if(ts.isCallExpression(n)&&n.expression.getText(source)==='t'&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0])) assert.ok(english[n.arguments[0].text],file+': '+n.arguments[0].text)
   ts.forEachChild(n,visit)
  }
  visit(source)
 }
})
test('localized counts and comment metadata preserve names',()=>{
 const en=load(['en']),zh=load(['zh'])
 assert.equal(en.countText(1,'cards'),'1 card')
 assert.equal(en.countText(2,'boards'),'2 boards')
 assert.equal(zh.countText(2,'cards'),'2 张卡片')
 assert.equal(en.commentAuthor('中文昵称（访客）'),'中文昵称 (guest)')
 assert.equal(en.commentAuthor('Custom name'),'Custom name')
 assert.equal(en.commentAuthor('名字（成员）'),'名字 (member)')
 assert.equal(en.commentAuthor('名字（子管理员）'),'名字 (workspace administrator)')
})
test('language updates subscribers in place without reloading',()=>{
 const i=load(['zh']);let calls=0;const stop=i.subscribeLanguage(()=>{calls++})
 i.setLanguage('en');assert.equal(i.getLanguage(),'en');assert.equal(i.t('保存'),'Save');assert.equal(calls,1)
 i.setLanguage('en');assert.equal(calls,1)
 stop();i.setLanguage('zh');assert.equal(calls,1)
 assert.ok(!fs.readFileSync(path.join(root,'i18n.ts'),'utf8').includes('location.reload'))
})
