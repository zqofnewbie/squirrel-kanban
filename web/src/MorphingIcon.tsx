import { MorphIcon } from 'morphicons/react'

// Existing project glyphs, expressed as paths. No additional icon catalog is loaded.
// Stable module-level inputs let Morphicons reuse its shape/transition caches.
const shapes = {
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 1 1 8 0Z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5',
  moon: 'M20 14a8.5 8.5 0 0 1-10-10A8.5 8.5 0 1 0 20 14Z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z M15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0Z',
  eyeOff:
    'M3 3l18 18 M10.5 5.1A12 12 0 0 1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3 3.8 M6.3 6.3A20 20 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.7-1.7 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  panelClose:
    'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z M9 4v16 M16 8l-4 4 4 4',
  panelOpen:
    'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z M9 4v16 M13 8l4 4-4 4',
  fullscreen: 'M8 3H3v5 M16 3h5v5 M3 16v5h5 M16 21h5v-5',
  fullscreenExit: 'M3 8h5V3 M21 8h-5V3 M8 21v-5H3 M16 21v-5h5',
  minimap:
    'M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z M7 8h4 M7 11h2 M13 11h4a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z',
  close: 'M6 6l12 12 M18 6 6 18',
  chevronDown: 'M7 10l5 5 5-5',
  chevronUp: 'M7 14l5-5 5 5',
} as const

/** State changes animate; initial render and reduced-motion users stay still. */
export default function MorphingIcon({
  name,
  size = 18,
  className = '',
}: {
  name: keyof typeof shapes
  size?: number
  className?: string
}) {
  return (
    <MorphIcon
      icon={shapes[name]}
      size={size}
      strokeWidth={1.7}
      color="currentColor"
      spring="snappy"
      reducedMotion="user"
      className={`ui-icon ${className}`}
      data-morph-icon={name}
      aria-hidden="true"
      focusable="false"
    />
  )
}
