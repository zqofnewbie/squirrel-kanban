import { useEffect, useState } from 'react'
import { useLanguage } from './useLanguage'
import { t } from './i18n'
import { COLOR_PALETTE } from './colors'
import { Button, Menu, Select } from './ui'
import Icon from './Icon'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

export function renderCardMarkdown(source: string) {
  try { return DOMPurify.sanitize(marked.parse(source, { gfm: true, breaks: true }) as string) } catch { return '' }
}

export function CardColumnSelect({value, columns, disabled, onChange}: {value:number; columns:{id:number;name:string;color?:string}[];disabled?:boolean;onChange:(id:number)=>void}) {
  useLanguage()
  return <Select className="card-column-select" label={t('移动到列表')} value={value} disabled={disabled} options={columns.map(c=>({value:c.id,label:c.name,color:c.color}))} onChange={onChange}/>
}

export function CardCoverPicker({cover, busy, onSave}: {cover:string;busy:boolean;onSave:(color:string)=>Promise<boolean>}) {
  useLanguage()
  const [draft,setDraft]=useState(cover || '#629FF0')
  useEffect(()=>setDraft(cover || '#629FF0'),[cover])
  return <Menu align="left" width={236} trigger={(_,toggle)=><button disabled={busy} onClick={toggle} className="cover-trigger"><span style={{background:cover || 'var(--canvas)'}}/><span>{cover?t('更换颜色'):t('选择封面')}</span><Icon name="chevron" size={14}/></button>}>
    {close=><div className="p-2"><div className="cover-palette">{['',...COLOR_PALETTE.slice(0,11).map(([,color])=>color)].map(color=><button key={color || 'none'} disabled={busy} aria-label={color?t('封面颜色 {0}',[color]):t('无封面')} aria-pressed={(cover || '')===color} style={{background:color || 'var(--canvas)'}} onClick={async()=>{if(await onSave(color))close()}}>{(cover || '')===color?<Icon name="check" size={14}/>:!color?<Icon name="close" size={14}/>:null}</button>)}</div><div className="mt-3 flex items-center justify-between gap-2"><label className="flex items-center gap-2 text-xs text-[var(--muted)]">{t('自定义')}<input type="color" disabled={busy} aria-label={t('自定义封面颜色')} value={draft} onChange={e=>setDraft(e.target.value)} className="native-color-input"/></label><Button size="sm" disabled={busy} onClick={async()=>{if(await onSave(draft))close()}}>{t('应用')}</Button></div></div>}
  </Menu>
}
