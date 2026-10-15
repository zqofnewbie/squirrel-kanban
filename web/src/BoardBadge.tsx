import { boardColor, boardHue } from './boardColors'
// 看板 ID 决定颜色，创建、刷新和排序都不会改变已有图标的配色。
export default function BoardBadge({ seed = 0 }: { seed?: number }) {
  const hue = boardHue(seed)
  const bg = `hsl(${hue.toFixed(3)} 65% 94%)`
  const cap = boardColor(seed)
  return (
    <svg
      className="board-badge"
      width="28"
      height="28"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="10" fill={bg} />
      <path d="M16 7c0-2 2-3 3-3" stroke={cap} strokeWidth="2" fill="none" strokeLinecap="round" />
      <path
        d="M8 14c0 8 4 12 8 13 4-1 8-5 8-13"
        fill="#F9DBB5"
        stroke="#C39B76"
        strokeWidth="1.2"
      />
      <path d="M7 14c0-5 4-7 9-7s9 2 9 7c0 2-18 2-18 0Z" fill={cap} />
      <path
        d="m11 9 3 4m3-5 3 4"
        stroke="#fff"
        strokeOpacity=".55"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="12.5" cy="18" r="1" fill="#725741" />
      <circle cx="19.5" cy="18" r="1" fill="#725741" />
      <path
        d="M14 21q2 2 4 0"
        stroke="#725741"
        fill="none"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <ellipse cx="10.5" cy="20.5" rx="1.5" ry=".8" fill="#EDA7A0" />
      <ellipse cx="21.5" cy="20.5" rx="1.5" ry=".8" fill="#EDA7A0" />
    </svg>
  )
}
