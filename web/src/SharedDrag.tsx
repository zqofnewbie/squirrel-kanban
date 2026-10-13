import { createPortal } from 'react-dom'
import { useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { BoardScale } from './BoardZoom'
import { boardCollision, cardDropAnimation, moveBoardCard } from './boardDrag'
import CardTile from './CardTile'
import type { BoardDetail, Card } from './types'

export function SharedDrag({ board, enabled, move, preview, onDragging, children }: {board:BoardDetail; enabled:boolean; move:(card:number,column:number,before:number)=>Promise<void>; preview:(board:BoardDetail)=>void; onDragging:(active:boolean)=>void; children:ReactNode}) {
 const scale=useContext(BoardScale)
 const [active,setActive]=useState<Card|null>(null)
 const [width,setWidth]=useState(266)
 const origin=useRef(board),current=useRef(board);current.current=board
 const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:5}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}))
 const column=(id:string|number)=>typeof id==='string'&&id.startsWith('col:')?Number(id.slice(4)):current.current.columns.find(col=>col.cards.some(c=>c.id===id))?.id
 const update=(id:number,to:number,index:number)=>{current.current=moveBoardCard(current.current,id,to,index);preview(current.current)}
 const cancel=()=>{setActive(null);preview(origin.current);onDragging(false)}
 return <DndContext sensors={sensors} collisionDetection={boardCollision} onDragStart={({active})=>{
  origin.current=board;onDragging(true)
  setActive(board.columns.flatMap(col=>col.cards).find(c=>c.id===active.id)??null)
  setWidth((active.rect.current.initial?.width??266*scale)/scale)
 }} onDragOver={({active,over})=>{
  if(!enabled||!over)return
  const from=column(active.id),to=column(over.id);if(!from||!to||from===to)return
  const target=current.current.columns.find(col=>col.id===to)!
  let index=target.cards.length
  if(typeof over.id==='number'){const at=target.cards.findIndex(c=>c.id===over.id);if(at>=0)index=at+(active.rect.current.translated&&active.rect.current.translated.top>over.rect.top+over.rect.height/2?1:0)}
  update(Number(active.id),to,index)
 }} onDragCancel={cancel} onDragEnd={async({active,over})=>{
  if(!enabled||!over){cancel();return}
  const to=column(active.id);if(!to){cancel();return}
  const target=current.current.columns.find(col=>col.id===to)!
  if(column(over.id)===to&&typeof over.id==='number'&&over.id!==active.id){const index=target.cards.findIndex(c=>c.id===over.id);if(index>=0)update(Number(active.id),to,index)}
  const list=current.current.columns.find(col=>col.id===to)!.cards,index=list.findIndex(c=>c.id===active.id)
  setActive(null);onDragging(false)
  await move(Number(active.id),to,list[index+1]?.id??0)
 }}>{children}{createPortal(<DragOverlay adjustScale={false} dropAnimation={cardDropAnimation}>{active&&<div className="card-drag-preview rounded-[10px]" style={{zoom:scale,width}}><CardTile overlay card={active} dimmed={false} onOpen={()=>{}} onRename={async()=>{}}/></div>}</DragOverlay>,document.body)}</DndContext>
}
export function SharedDropColumn({id,cards,children,enabled}:{id:number;cards:Card[];children:ReactNode;enabled:boolean}) {
 // Preserve sorting transitions across useDroppable pointer updates.
 const cardIds=useMemo(()=>cards.map(card=>card.id),[cards])
 const {setNodeRef}=useDroppable({id:`col:${id}`,data:{type:'column'},disabled:!enabled})
 return <section ref={setNodeRef} className="kanban-column" data-column-id={id}><SortableContext items={cardIds} strategy={verticalListSortingStrategy}>{children}</SortableContext></section>
}
