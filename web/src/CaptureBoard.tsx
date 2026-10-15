import { useRef, useState } from 'react'
import type { BoardDetail } from './types'
import { Button } from './ui'
import Icon from './Icon'
import { t } from './i18n'
import { notify } from './notifications'

export default function CaptureBoard({ board }: { board: BoardDetail }) {
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  async function capture() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      const node = document.querySelector<HTMLElement>('.board-content .board-canvas')
      if (!node) throw new Error('Canvas unavailable')
      const { captureCanvas } = await import('./captureCanvas')
      await captureCanvas(node, board)
      notify(t('画布截图已下载'))
    } catch {
      notify(t('截图失败，请重试'), 'error')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <Button disabled={busy} onClick={() => void capture()} aria-busy={busy}>
      <Icon name="camera" size={16} />
      {busy ? t('正在截图…') : t('截图')}
    </Button>
  )
}
