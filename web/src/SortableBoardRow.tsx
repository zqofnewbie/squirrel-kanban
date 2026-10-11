import type { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Icon from './Icon'
import { t } from './i18n'
export default function SortableBoardRow({ id, name, selected, disabled, children }: { id: number; name: string; selected: boolean; disabled: boolean; children: ReactNode }) {
 const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, disabled, transition: { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' } })
 return <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 5 : undefined }} className={`board-nav-row ${selected ? 'selected' : ''} ${isDragging ? 'is-sorting' : ''}`}>
  <button className="board-sort-handle" {...attributes} {...listeners} disabled={disabled} aria-label={t('拖动排序：{0}', [name])} title={t('拖动排序，或按空格后使用方向键')}><Icon name="grip" size={13} /></button>{children}
 </div>
}
