import { useDndContext } from '@dnd-kit/core'
import type { RefObject } from 'react'
import CardTile from './CardTile'
import VirtualList from './VirtualList'
import type { Card } from './types'
import type { CardSection } from './store'

export default function VirtualCards({
  cards,
  scrollRef,
  onOpen,
  onRename,
}: {
  cards: Card[]
  scrollRef: RefObject<HTMLDivElement>
  onOpen: (id: number, section?: CardSection) => void
  onRename: (id: number, title: string) => Promise<void>
}) {
  const { active } = useDndContext()
  return (
    <VirtualList
      items={cards}
      scrollRef={scrollRef}
      activeId={active?.id}
      renderItem={(card) => (
        <CardTile card={card} dimmed={false} onOpen={onOpen} onRename={onRename} />
      )}
    />
  )
}
