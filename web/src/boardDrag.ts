import { closestCenter, pointerWithin, rectIntersection, defaultDropAnimationSideEffects, type CollisionDetection } from '@dnd-kit/core'
import type { BoardDetail, Card } from './types'
export const cardTransition = { duration:220, easing:'cubic-bezier(.2,.8,.2,1)' }
export const cardDropAnimation = { ...cardTransition, sideEffects:defaultDropAnimationSideEffects({styles:{active:{opacity:'0'}}}) }
export const boardCollision:CollisionDetection=args=>{
 const columns=args.droppableContainers.filter(c=>c.data.current?.type==='column')
 if(args.active.data.current?.type==='column')return closestCenter({...args,droppableContainers:columns})
 const hit=pointerWithin({...args,droppableContainers:columns})[0]??rectIntersection({...args,droppableContainers:columns})[0]
 if(!hit)return []
 const id=Number(String(hit.id).replace('col:',''))
 const cards=args.droppableContainers.filter(c=>c.data.current?.type==='card'&&c.data.current?.columnId===id&&!!c.data.current?.pinned===!!args.active.data.current?.pinned)
 // Rank card slots by the pointer, not the dragged card's centre. The latter
 // drifts during scrolling (especially when a virtualized source stays mounted).
 const point=args.pointerCoordinates
 const collisionRect=point?{top:point.y,bottom:point.y,left:point.x,right:point.x,width:0,height:0}:args.collisionRect
 return cards.length?closestCenter({...args,collisionRect,droppableContainers:cards}):[hit]
}
export function moveBoardCard(board:BoardDetail,id:number,columnId:number,index:number):BoardDetail {
 const card=board.columns.flatMap(col=>col.cards).find(c=>c.id===id)
 if(!card||!board.columns.some(col=>col.id===columnId))return board
 const columns=board.columns.map(col=>({...col,cards:col.cards.filter(c=>c.id!==id)}))
 const target=columns.find(col=>col.id===columnId)!
 target.cards.splice(Math.max(0,Math.min(index,target.cards.length)),0,{...card,column_id:columnId})
 target.cards.sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned))
 return {...board,columns}
}

// Restore only the dragged card: unrelated live edits must survive cancellation.
export function restoreBoardCard(current:BoardDetail, original:BoardDetail, id:number):BoardDetail {
 if(current.id!==original.id)return current
 const source=original.columns.find(col=>col.cards.some(card=>card.id===id))
 const target=current.columns.find(col=>col.id===source?.id)
 if(!source||!target)return current
 const originalIndex=source.cards.findIndex(card=>card.id===id)
 const remaining=target.cards.filter(card=>card.id!==id)
 const next=source.cards.slice(originalIndex+1).find(card=>remaining.some(item=>item.id===card.id))
 const previous=source.cards.slice(0,originalIndex).reverse().find(card=>remaining.some(item=>item.id===card.id))
 const index=next?remaining.findIndex(card=>card.id===next.id):previous?remaining.findIndex(card=>card.id===previous.id)+1:0
 return moveBoardCard(current,id,source.id,index)
}

// Positions are stored independently of pin priority. The next item must be in
// the same pin group, otherwise the server can put a last pinned card first.
export function cardBeforeId(cards:Card[], id:number):number {
 const index=cards.findIndex(card=>card.id===id)
 if(index<0)return 0
 return cards.slice(index+1).find(card=>!!card.pinned===!!cards[index].pinned)?.id??0
}
