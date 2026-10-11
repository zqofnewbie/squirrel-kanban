import { useDndContext } from '@dnd-kit/core'
import ColumnScrollFooter from './ColumnScrollFooter'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import VirtualList from './VirtualList'
import type { Card } from './types'

export default function GuestCardList({ cards, filter, children, footer, empty }: { cards: Card[]; filter: string; children: (card: Card) => ReactNode; footer?: ReactNode; empty?: ReactNode }) {
  const { active } = useDndContext()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [mounted, setMounted] = useState(false)
  const attach = useCallback((element: HTMLDivElement | null) => { scrollRef.current = element; setMounted(!!element) }, [])
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }) }, [filter])
  return <><div ref={attach} className="shared-card-scroll column-cards scroll-thin">{!cards.length ? empty : cards.length >= 80 ? mounted && <VirtualList activeId={active?.id} items={cards} scrollRef={scrollRef} renderItem={children} /> : cards.map(children)}</div><ColumnScrollFooter target={scrollRef}>{footer}</ColumnScrollFooter></>
}
