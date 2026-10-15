import { useEffect, useId, useRef, useState } from 'react'
import { t } from './i18n'

interface AnimationController {
  play(): void
  reset(): void
  destroy(): void
  ready: Promise<void>
}
interface AnimationModule {
  mountSquirrelAnimation(root: HTMLElement): AnimationController
}

let assets: Promise<{ scene: string; motion: AnimationModule }> | undefined
function loadAssets() {
  return (assets ??= Promise.all([
    fetch('/squirrel-hover/scene.svg?v=kanban-logo-1').then((response) => {
      if (!response.ok) throw new Error('Unable to load squirrel artwork')
      return response.text()
    }),
    import('./squirrelAnimation.js') as Promise<AnimationModule>,
  ])
    .then(([scene, motion]) => ({ scene, motion }))
    .catch((error) => {
      assets = undefined
      throw error
    }))
}

export default function SquirrelLogo() {
  const host = useRef<HTMLSpanElement>(null)
  const controller = useRef<AnimationController | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')

  useEffect(() => {
    const element = host.current
    if (!element) return
    const brand = element.closest('.brand')
    const enterBrand = (event: Event) => {
      if ((event as PointerEvent).pointerType === 'mouse') controller.current?.play()
    }
    brand?.addEventListener('pointerenter', enterBrand)
    let disposed = false
    let animation: AnimationController | undefined
    const visibility = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) animation?.reset()
    })
    visibility.observe(element)

    void loadAssets()
      .then(async ({ scene, motion }) => {
        if (disposed) return
        // Only trusted bundled artwork is inserted. Namespace SVG definitions so
        // multiple logos cannot borrow another instance's masks or clipping paths.
        element.innerHTML = scene
          .replace(/id="([^"]+)"/g, (_, part: string) => `id="${id}-${part}" data-part="${part}"`)
          .replace(/href="#/g, `href="#${id}-`)
          .replace(/url\(#/g, `url(#${id}-`)
        animation = motion.mountSquirrelAnimation(element)
        controller.current = animation
        await animation.ready
        if (!disposed) setState('ready')
      })
      .catch(() => {
        if (!disposed) {
          animation?.destroy()
          controller.current = null
          setState('error')
        }
      })

    return () => {
      disposed = true
      visibility.disconnect()
      brand?.removeEventListener('pointerenter', enterBrand)
      animation?.destroy()
      controller.current = null
      element.replaceChildren()
    }
  }, [id])

  return (
    <button
      type="button"
      className="squirrel-logo"
      data-state={state}
      aria-label={t('播放松鼠追逐松果动画')}
      aria-busy={state === 'loading'}
      disabled={state !== 'ready'}
      onClick={() => controller.current?.play()}
    >
      <img
        className="squirrel-logo-fallback"
        src="/squirrel-logo.png"
        width={48}
        height={48}
        alt=""
        aria-hidden="true"
      />
      <span ref={host} className="squirrel-logo-scene" aria-hidden="true" />
    </button>
  )
}
