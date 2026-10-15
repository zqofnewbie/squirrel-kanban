import type { CSSProperties } from 'react'

export const BACKGROUND_COLORS = [
  ['清晨蓝', '#EDF4FF'],
  ['薄荷露', '#EBF8F3'],
  ['莓果奶昔', '#FFF0F5'],
  ['丁香雾', '#F2EEFF'],
  ['海盐', '#EAF7FA'],
  ['杏桃', '#FFF1E9'],
  ['云朵', '#F7F9FC'],
  ['青苹果', '#F1F7E9'],
] as const
export const BACKGROUND_SCENES = [
  ['grove', '松鼠的森林'],
  ['sea', '海边的风'],
  ['hills', '远山与云'],
  ['orbit', '星球漫游'],
] as const
export function boardBackground(
  background: string,
  boardId: number,
  shareId?: string,
): CSSProperties {
  const scene = BACKGROUND_SCENES.find(([id]) => background === `preset:${id}`)
  const image = scene
    ? `/assets/backgrounds/${scene[0]}.svg`
    : background.startsWith('upload:')
      ? shareId
        ? `/api/shared/${encodeURIComponent(shareId)}/background?v=${encodeURIComponent(background)}`
        : `/api/boards/${boardId}/background?v=${encodeURIComponent(background)}`
      : ''
  return image
    ? { backgroundImage: `url("${image}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { backgroundColor: /^#[0-9a-f]{6}$/i.test(background) ? background : 'var(--canvas)' }
}
