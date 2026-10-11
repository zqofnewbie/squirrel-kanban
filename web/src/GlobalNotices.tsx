import { createPortal } from 'react-dom'
import { dismissNotice, useNotices } from './notifications'
import Icon from './Icon'
import { t } from './i18n'
import { useLanguage } from './useLanguage'
export default function GlobalNotices() {
 useLanguage()
 const items=useNotices(s=>s.items)
 return createPortal(<div className="global-notices">{items.map(item=><div key={item.id} className={`global-notice ${item.kind}`} role={item.kind==='error'?'alert':'status'}><Icon name={item.kind==='success'?'check':item.kind==='error'?'close':'help'} size={18}/><span>{item.message}</span><button aria-label={t('关闭提示')} onClick={()=>dismissNotice(item.id)}><Icon name="close" size={14}/></button></div>)}</div>,document.body)
}
