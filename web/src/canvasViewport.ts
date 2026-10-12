type Viewport = Pick<HTMLElement, 'clientWidth' | 'clientHeight' | 'scrollLeft' | 'scrollTop'>

// Remember the intended center separately from the scroll position clamped by
// browser edges. An enter/exit round trip is reversible until the user pans.
export function createViewportAnchor(element: Viewport) {
  let size = { width: element.clientWidth, height: element.clientHeight }
  let position = { left: element.scrollLeft, top: element.scrollTop }
  let applied = { ...position }
  return {
    track() {
      // Layout can clamp scroll before ResizeObserver has handled the new size.
      if (size.width === element.clientWidth && size.height === element.clientHeight &&
          (element.scrollLeft !== applied.left || element.scrollTop !== applied.top)) {
        position = { left: element.scrollLeft, top: element.scrollTop }
        applied = { ...position }
      }
    },
    resize() {
      const next = { width: element.clientWidth, height: element.clientHeight }
      if (!next.width || !next.height) return
      position = { left: position.left + (size.width - next.width) / 2, top: position.top + (size.height - next.height) / 2 }
      element.scrollLeft = position.left
      element.scrollTop = position.top
      size = next
      applied = { left: element.scrollLeft, top: element.scrollTop }
    },
  }
}
