import { useLanguage } from './useLanguage'
import { t } from './i18n'
import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { useStore } from './store'
import type { Board } from './types'
import { BACKGROUND_COLORS, BACKGROUND_SCENES, boardBackground } from './backgrounds'
import { Button, Modal } from './ui'
import Icon from './Icon'

export default function BoardAppearance({ board, open, onClose }: { board: Board; open: boolean; onClose: () => void }) {
  useLanguage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [color, setColor] = useState('#EDF4FF')
  const file = useRef<HTMLInputElement>(null)
  const saving = useRef(false)
  useEffect(() => { if (open) { setError(''); setColor(/^#[0-9a-f]{6}$/i.test(board.background) ? board.background : '#EDF4FF') } }, [open, board.id])
  async function save(value: string | File) {
    if (saving.current) return
    saving.current = true; setBusy(true); setError('')
    try {
      if (value instanceof File && value.size > 12 * 1024 * 1024) throw new Error(t("背景图片不能超过 12 MB"))
      const saved = value instanceof File ? await api.uploadBackground(board.id, value) : await api.updateBoard(board.id, { background: value })
      useStore.setState(state => ({ boards: state.boards.map(item => item.id === saved.id ? { ...item, ...saved } : item), ...(state.board?.id === saved.id ? { board: { ...state.board, ...saved } } : {}) }))
    } catch (e) { setError(e instanceof Error ? e.message : t("背景保存失败，请重试")) }
    finally { saving.current = false; setBusy(false) }
  }
  return <Modal open={open} title={t("看板外观")} onClose={() => { if (!busy) onClose() }} width={520} footer={<div className="flex items-center justify-between gap-3"><Button disabled={busy} onClick={() => void save('default')}>{t("恢复默认")}</Button><span role="status" className="text-xs text-[var(--muted)]">{busy ? t("正在保存…") : t("更改已自动保存")}</span><Button variant="primary" disabled={busy} onClick={onClose}>{t("完成")}</Button></div>}>
    <p className="mb-4 text-xs text-[var(--muted)]">{t("为「")}{board.name}{t("」挑一片喜欢的风景。选择后自动保存，分享页面也会同步。")}</p>
    {error && <p role="alert" className="mb-3 text-xs text-red-600">{error}</p>}
    <fieldset disabled={busy} className="appearance-options">
      <legend>{t("纯色背景")}</legend>
      <div className="background-colors">{BACKGROUND_COLORS.map(([name, value]) => <button key={value} title={t(name)} aria-label={t("背景：{0}", [t(name)])} aria-pressed={board.background.toUpperCase() === value} onClick={() => void save(value)} style={{ background: value }}>{board.background.toUpperCase() === value && <Icon name="check" size={18} />}</button>)}</div>
      <div className="my-4 flex items-center gap-3"><label className="flex items-center gap-2 text-xs">{t("自定义颜色")}<input type="color" aria-label={t("自定义看板背景颜色")} className="native-color-input" value={color} onChange={e => setColor(e.target.value)} onInput={e => setColor(e.currentTarget.value)} /></label><Button size="sm" onClick={() => void save(color)}>{t("应用颜色")}</Button></div>
      <h4>{t("小小风景")}</h4>
      <div className="background-scenes">{BACKGROUND_SCENES.map(([id, name]) => <button key={id} aria-label={t("背景：{0}", [t(name)])} aria-pressed={board.background === `preset:${id}`} onClick={() => void save(`preset:${id}`)}><span style={boardBackground(`preset:${id}`, board.id)}>{board.background === `preset:${id}` && <Icon name="check" />}</span><span>{t(name)}</span></button>)}</div>
      <div className="background-upload"><input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden onChange={e => { const selected = e.target.files?.[0]; e.target.value = ''; if (selected) void save(selected) }} /><Button onClick={() => file.current?.click()}><Icon name="upload" size={15} />{t("上传背景图片")}</Button><span>{t("PNG / JPG / WebP / GIF / AVIF · 最大 12 MB")}</span></div>
      {board.background.startsWith('upload:') && <div className="background-current" style={boardBackground(board.background, board.id)}><span>{t("当前上传的背景")}</span></div>}
    </fieldset>

  </Modal>
}
