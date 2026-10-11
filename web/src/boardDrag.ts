import { closestCenter, pointerWithin, rectIntersection, defaultDropAnimationSideEffects, type CollisionDetection } from '@dnd-kit/core'
import type { BoardDetail } from './types'
export const cardTransition = { duration:220, easing:'cubic-bezier(.2,.8,.2,1)' }
export const cardDropAnimation = { ...cardTransition, sideEffects:defaultDropAnimationSideEffects({styles:{active:{opacity:'0'}}}) }
export const boardCollision:CollisionDetection=args=>{
 const columns=args.droppableContainers.filter(c=>c.data.current?.type==='column')
 if(args.active.data.current?.type==='column')return closestCenter({...args,droppableContainers:columns})
 const hit=pointerWithin({...args,droppableContainers:columns})[0]??rectIntersection({...args,droppableContainers:columns})[0]
 if(!hit)return []
 const id=Number(String(hit.id).replace('col:',''))
 const cards=args.droppableContainers.filter(c=>c.data.current?.type==='card'&&c.data.current?.columnId===id)
 return cards.length?closestCenter({...args,droppableContainers:cards}):[hit]
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
