export interface SquirrelAnimationController {
  play(): void
  reset(): void
  destroy(): void
  ready: Promise<void>
}
export function mountSquirrelAnimation(root: HTMLElement): SquirrelAnimationController
