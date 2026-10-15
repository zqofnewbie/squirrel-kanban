import CardTile from './CardTile'
import { Empty } from './ui'
import { t } from './i18n'
import type { BoardDetail } from './types'
import { boardBackground } from './backgrounds'

const noop = () => {}
const rename = async () => {}

// A non-interactive export tree: no virtual rows, drag registration or scroll
// containers. It exists only while exporting and never changes the live board.
export default function BoardExport({ board }: { board: BoardDetail }) {
  return (
    <div
      data-board-export
      style={{
        ...boardBackground(board.background, board.id),
        position: 'relative',
        width: Math.max(1, board.columns.length) * 310 + 14,
        padding: 16,
        backgroundColor: board.background.startsWith('#') ? board.background : 'var(--canvas)',
      }}
    >
      <div
        className="board-background-shade"
        style={
          document.documentElement.classList.contains('dark')
            ? { background: '#0f1925', opacity: 0.48 }
            : undefined
        }
      />
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', position: 'relative' }}>
        {board.columns.map((column) => (
          <section
            key={column.id}
            className="kanban-column"
            style={{
              width: 292,
              flexShrink: 0,
              height: 'auto',
              maxHeight: 'none',
              borderRadius: 12,
            }}
          >
            <div className="column-heading flex items-center gap-2 pb-2">
              <span
                className="column-color-dot"
                style={{ background: column.color || '#94A3B8' }}
              />
              <h2 className="min-w-0 flex-1 text-[13px] font-medium">{column.name}</h2>
              <span className="text-xs text-[var(--muted)]">{column.cards.length}</span>
            </div>
            {column.cards.map((card) => (
              <CardTile
                key={card.id}
                overlay
                card={card}
                dimmed={false}
                canEdit={false}
                canPin={false}
                canMove={false}
                onOpen={noop}
                onRename={rename}
              />
            ))}
            {!column.cards.length && <Empty compact text={t('这里还没有卡片')} />}
          </section>
        ))}
      </div>
    </div>
  )
}
