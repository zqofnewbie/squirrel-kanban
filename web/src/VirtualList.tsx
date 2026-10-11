import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, type ReactNode, type RefObject } from 'react'

export default function VirtualList<T extends { id: number }>({ items, scrollRef, activeId, renderItem }: { items: T[]; scrollRef: RefObject<HTMLDivElement>; activeId?: number | string; renderItem: (item: T) => ReactNode }) {
  const activeIndex = activeId == null ? -1 : items.findIndex(item => item.id === activeId)
  const getItemKey = useCallback((index: number) => items[index].id, [items])
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: () => 88,
    overscan: 7,
    paddingStart: 5,
    rangeExtractor: range => {
      const indices = defaultRangeExtractor(range)
      if (activeIndex >= 0 && !indices.includes(activeIndex)) indices.push(activeIndex)
      return indices.sort((a, b) => a - b)
    },
  })
  return <div className="virtual-card-list" style={{ height: virtual.getTotalSize(), position: 'relative' }}>
    {virtual.getVirtualItems().map(row => <div key={row.key} data-index={row.index} ref={virtual.measureElement}
      className="virtual-card-row" style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start}px)`, paddingBottom: 8 }}>
      {renderItem(items[row.index])}
    </div>)}
  </div>
}
