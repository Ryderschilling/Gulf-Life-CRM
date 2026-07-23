'use client'

// ============================================================
// Gulf AI — the identity mark + small shared AI primitives.
//
// The mark is a "tide orb": layered gulf waves drifting inside
// a circle, wrapped in a slowly-rotating gradient ring.
// Pure SVG + CSS — no animation libraries, no image assets.
//
//   <AIMark />                 small inline mark (idle)
//   <AIMark thinking />        waves + ring speed up (AI working)
//   <AIMark breathe />         gentle scale breathing (hero usage)
//   <AIMark variant="white" /> for use on gradient/dark surfaces
//
//   <AIBadge />                tiny "AI" gradient pill for tagging rows
//   <AIThinking />             mark + shimmering status label
// ============================================================

import { useId } from 'react'
import { cn } from '@/lib/utils'

// Both waves repeat every 24 units across a 96-wide path, so the
// -48px CSS drift loops seamlessly. B starts on the opposite phase.
const WAVE_A =
  'M0 22 Q6 16.5 12 22 T24 22 T36 22 T48 22 T60 22 T72 22 T84 22 T96 22 V48 H0 Z'
const WAVE_B =
  'M0 29 Q6 32.5 12 29 T24 29 T36 29 T48 29 T60 29 T72 29 T84 29 T96 29 V48 H0 Z'

export interface AIMarkProps {
  size?: number
  /** Accepted so the mark can slot into icon slots (e.g. sidebar nav). Unused. */
  strokeWidth?: number
  thinking?: boolean
  breathe?: boolean
  variant?: 'color' | 'white'
  className?: string
}

export function AIMark({ size = 20, thinking, breathe, variant = 'color', className }: AIMarkProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const gid = `aig${uid}`
  const cid = `aic${uid}`
  const white = variant === 'white'

  const ringStroke = white ? 'rgba(255,255,255,0.85)' : `url(#${gid})`
  const innerFill = white ? 'rgba(255,255,255,0.14)' : 'rgba(171,144,85,0.09)'
  const waveFill = white ? '#ffffff' : `url(#${gid})`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden
      className={cn('shrink-0 ai-mark', thinking && 'ai-mark--thinking', breathe && 'ai-breathe', className)}
    >
      <defs>
        <linearGradient id={gid} x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#c9a96e" />
          <stop offset="0.55" stopColor="#AB9055" />
          <stop offset="1" stopColor="#907240" />
        </linearGradient>
        <clipPath id={cid}>
          <circle cx="24" cy="24" r="15.5" />
        </clipPath>
      </defs>

      {/* rotating gradient ring */}
      <g className="ai-ring">
        <circle cx="24" cy="24" r="21" stroke={ringStroke} strokeWidth="3" />
      </g>

      {/* the gulf */}
      <circle cx="24" cy="24" r="15.5" fill={innerFill} />
      <g clipPath={`url(#${cid})`}>
        <path className="ai-wave-b" d={WAVE_B} fill={waveFill} opacity={white ? 0.45 : 0.35} />
        <path className="ai-wave-a" d={WAVE_A} fill={waveFill} opacity={white ? 0.95 : 0.9} />
      </g>
    </svg>
  )
}

export function AIBadge({ label = 'AI', className }: { label?: string; className?: string }) {
  return (
    <span className={cn('ai-badge', className)}>
      <AIMark size={11} />
      {label}
    </span>
  )
}

export function AIThinking({ label = 'Thinking…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5 py-1.5 ai-msg-in', className)}>
      <AIMark size={22} thinking />
      <span className="ai-shimmer-text text-[13px] font-semibold">{label}</span>
    </div>
  )
}
