import type { SVGProps } from 'react'

const paths = {
  empty: <><path d="m4 9 3-5h10l3 5v10H4Z" /><path d="M4 9h5l1.5 3h3L15 9h5M9 4l-1 5M15 4l1 5" /></>,
  grip: <path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" strokeWidth="3" />,
  panelClose: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16m7-12-4 4 4 4" /></>,
  panelOpen: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16m4-12 4 4-4 4" /></>,
  pin: <path d="m15 3 6 6-4 1-3 5-1 3-7-7 3-1 5-3 1-4ZM3 21l6-6" />,
  hand: <path d="M8 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v8c0 5-3 7-7 7-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-2l2 2Z" />,
  minimap: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M7 8h4M7 11h2" /><rect x="12" y="11" width="6" height="5" rx="1" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  description: <path d="M5 5h14M5 10h14M5 15h10M5 20h7"/>,
  comment: <path d="M21 12a8 8 0 0 1-8 8H4l1-5a8 8 0 1 1 16-3Z"/>,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  board: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></>,
  archive: <><rect x="3" y="3" width="18" height="5" rx="1" /><path d="M5 8v12h14V8M10 12h4" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01" /></>,
  link: <><path d="m10 13 4-4M8 15l-2 2a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0M14 9l2-2a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0" transform="translate(1 0)" /></>,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  chevron: <path d="m7 10 5 5 5-5" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></>,
  moon: <path d="M20 14a8.5 8.5 0 0 1-10-10A8.5 8.5 0 1 0 20 14Z" />,
  edit: <><path d="m15 4 5 5M4 20l5-1 11-11a2 2 0 0 0-5-5L4 14Z" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
  checklist: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m7 12 3 3 7-7" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M7 14h2M13 14h2" /></>,
  attachment: <path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2" />,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6" /></>,
  refresh: <><path d="M20 7V3m0 4h-4M4 17v4m0-4h4M20 7A9 9 0 0 0 4 6M4 17a9 9 0 0 0 16 1" /></>,
  copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 4V3H3v13h1" /></>,
  external: <><path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  back: <path d="M20 12H4m6-6-6 6 6 6" />,
  settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="var(--surface)" /><circle cx="15" cy="17" r="3" fill="var(--surface)" /></>,
  logout: <><path d="M9 3H3v18h6M9 12h12m-5-5 5 5-5 5" /></>,
} satisfies Record<string, React.ReactNode>
export type IconName = keyof typeof paths
export default function Icon({ name, size = 18, className = '', ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return <svg {...props} className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>
}
