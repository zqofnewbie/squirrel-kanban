const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const vm=require('node:vm')
const ts=require('typescript')
const code=ts.transpileModule(fs.readFileSync(require.resolve('../src/ui.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText
const context={exports:{},require(name){
 if(name==='./focus')return {focusElement(){},keyboardFocus:()=>false}
 if(name==='./useLanguage')return {useLanguage(){}}
 if(name==='./i18n')return {t:s=>s}
 if(name==='./Icon')return ()=>null
 if(name==='./usePresence'||name==='./useDialogFocus')return {}
 return require(name)
}}
vm.runInNewContext(code,context)
const {Button,Select,MenuItem}=context.exports
test('ordinary buttons never implicitly submit a surrounding form; explicit save buttons still submit',()=>{
 assert.equal(Button({children:'Cancel'}).props.type,'button')
 assert.equal(Button({type:'submit',form:'member-form',children:'Save'}).props.type,'submit')
})
test('opening role and ownership selectors cannot submit a surrounding form',()=>{
 const select=Select({value:0,options:[{value:0,label:'Member'}],label:'Role',onChange(){}})
 assert.equal(select.props.trigger(false,()=>{}).props.type,'button')
})
test('menu options remain non-submitting controls',()=>{
 assert.equal(MenuItem({children:'Member',onClick(){}}).props.type,'button')
})
const administrationCode=ts.transpileModule(fs.readFileSync(require.resolve('../src/Administration.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText
function memberForm(){
 let calls=0,index=0
 const user={role:'member',username:'draft',display_name:'Draft',password:'test-password',disabled:false,workspace_ids:[]}
 const states=['users',[],[],false,'',null,user,null,false,'']
 const context={exports:{},HTMLInputElement:class {},require(name){
  if(name==='react')return {...require('react'),useId:()=> 'member-form',useEffect(){},useState:()=>[states[index++],()=>{}]}
  if(name==='./useLanguage')return {useLanguage(){}}
  if(name==='./i18n')return {t:s=>s,workspaceName:s=>s.name,countText:String}
  if(name==='./store')return {useStore:selector=>selector({me:{role:'admin'}})}
  if(name==='./api')return {api:{saveUser:async()=>{calls++},workspaces:async()=>[],users:async()=>[]}}
  if(name==='./ui')return Object.fromEntries(['Button','ConfirmDialog','Input','PasswordInput','Modal','Select'].map(k=>[k,()=>null]))
  if(name==='./Icon')return ()=>null
  return require(name)
 }}
 vm.runInNewContext(administrationCode,context)
 const root=context.exports.default()
 const modal=root.props.children.find(el=>el?.props?.title==='添加成员')
 return {form:modal.props.children,calls:()=>calls,Input:context.HTMLInputElement}
}
test('member form ignores implicit submission and unrelated controls; only Save creates a member',()=>{
 const {form,calls}=memberForm()
 form.props.onSubmit({preventDefault(){},nativeEvent:{submitter:null}})
 form.props.onSubmit({preventDefault(){},nativeEvent:{submitter:{getAttribute:()=>null}}})
 assert.equal(calls(),0)
 form.props.onSubmit({preventDefault(){},nativeEvent:{submitter:{getAttribute:key=>key==='data-member-save'?'true':null}}})
 assert.equal(calls(),1)
})
test('Enter in member inputs does not submit the form',()=>{
 const {form,Input,calls}=memberForm()
 let prevented=false
 form.props.onKeyDown({key:'Enter',target:new Input(),preventDefault(){prevented=true}})
 assert.equal(prevented,true)
 assert.equal(calls(),0)
})
test('password visibility is local, preserves input attributes and never submits the form',()=>{
 let visible=false
 const passwordContext={exports:{},require(name){
  if(name==='react')return {...require('react'),useState:()=>[visible,next=>{visible=typeof next==='function'?next(visible):next}]}
  return context.require(name)
 }}
 vm.runInNewContext(code,passwordContext)
 const props={value:'test-only-secret',autoComplete:'new-password',required:true,maxLength:72}
 const render=()=>passwordContext.exports.PasswordInput.render(props,null).props.children
 let [input,toggle]=render()
 assert.equal(input.props.type,'password')
 assert.equal(toggle.props.type,'button')
 assert.equal(toggle.props['aria-pressed'],false)
 toggle.props.onClick()
 ;[input,toggle]=render()
 assert.equal(input.props.type,'text')
 assert.equal(input.props.value,props.value)
 assert.equal(input.props.autoComplete,'new-password')
 assert.equal(input.props.required,true)
 assert.equal(input.props.maxLength,72)
 assert.equal(toggle.props['aria-pressed'],true)
 toggle.props.onClick()
 assert.equal(render()[0].props.type,'password')
})
