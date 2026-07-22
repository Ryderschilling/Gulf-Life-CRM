'use client'

// ============================================================
// UI Kit — shared primitives for the WhiteUI-style design.
// Light theme, white cards, indigo accent, soft status pills.
// ============================================================

import { type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, forwardRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Card ────────────────────────────────────────────────────
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('bg-card border border-line rounded-card shadow-card', className)}>
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, right, className }: {
  title: string; subtitle?: string; right?: ReactNode; className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-6 pt-5 pb-4', className)}>
      <div>
        <h2 className="text-[16px] font-semibold text-ink m-0">{title}</h2>
        {subtitle && <p className="text-[13px] text-ink-2 mt-0.5 m-0">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </div>
  )
}

// ── Stat card (top row, like the reference) ─────────────────
export function StatCard({ label, value, delta, deltaGood, icon, tint = 'accent' }: {
  label: string
  value: string | number
  delta?: string
  deltaGood?: boolean
  icon?: ReactNode
  tint?: 'accent' | 'good' | 'warn' | 'info' | 'grape' | 'bad'
}) {
  const tints: Record<string, string> = {
    accent: 'bg-accent-soft text-accent',
    good: 'bg-good-soft text-good',
    warn: 'bg-warn-soft text-warn',
    info: 'bg-info-soft text-info',
    grape: 'bg-grape-soft text-grape',
    bad: 'bg-bad-soft text-bad',
  }
  return (
    <Card className="px-5 py-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] text-ink-2 m-0 font-medium">{label}</p>
        <div className="flex items-baseline gap-2 mt-1.5">
          <span className="text-[26px] leading-none font-bold text-ink tracking-tight">{value}</span>
          {delta && (
            <span className={cn('text-[12px] font-semibold', deltaGood === false ? 'text-bad' : 'text-good')}>
              {delta}
            </span>
          )}
        </div>
      </div>
      {icon && (
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', tints[tint])}>
          {icon}
        </div>
      )}
    </Card>
  )
}

// ── Pills ───────────────────────────────────────────────────
export type PillTone = 'green' | 'yellow' | 'red' | 'blue' | 'violet' | 'gray' | 'indigo'

const PILL_TONES: Record<PillTone, string> = {
  green:  'bg-good-soft text-good',
  yellow: 'bg-warn-soft text-warn',
  red:    'bg-bad-soft text-bad',
  blue:   'bg-info-soft text-info',
  violet: 'bg-grape-soft text-grape',
  indigo: 'bg-accent-soft text-accent',
  gray:   'bg-[#f2f4f7] text-ink-2',
}

export function Pill({ tone = 'gray', children, className }: { tone?: PillTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold whitespace-nowrap', PILL_TONES[tone], className)}>
      {children}
    </span>
  )
}

// ── Buttons ─────────────────────────────────────────────────
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant
  size?: 'sm' | 'md'
  loading?: boolean
}>(function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }, ref) {
  const base = 'inline-flex items-center justify-center gap-1.5 font-semibold rounded-btn transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'
  const sizes = size === 'sm' ? 'text-[13px] px-3 py-1.5' : 'text-[14px] px-4 py-2'
  const variants: Record<BtnVariant, string> = {
    primary: 'bg-accent text-white hover:bg-accent-dark',
    secondary: 'bg-card text-ink border border-line-strong hover:bg-[#f7f8fb]',
    ghost: 'bg-transparent text-ink-2 hover:bg-[#f2f4f7] hover:text-ink',
    danger: 'bg-bad-soft text-bad hover:bg-[#fbd9d6]',
  }
  return (
    <button ref={ref} className={cn(base, sizes, variants[variant], className)} disabled={disabled || loading} {...rest}>
      {loading && <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full spin" />}
      {children}
    </button>
  )
})

// ── Inputs ──────────────────────────────────────────────────
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn('w-full bg-card border border-line-strong rounded-btn px-3 py-2 text-[14px] text-ink transition-shadow', className)}
        {...rest}
      />
    )
  }
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={cn('bg-card border border-line-strong rounded-btn px-3 py-2 text-[14px] text-ink cursor-pointer', className)}
        {...rest}
      >
        {children}
      </select>
    )
  }
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn('w-full bg-card border border-line-strong rounded-btn px-3 py-2 text-[14px] text-ink resize-y min-h-[80px]', className)}
        {...rest}
      />
    )
  }
)

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-ink-2 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[12px] text-ink-3 mt-1">{hint}</span>}
    </label>
  )
}

// ── Segmented control (Day / Week / Month style) ────────────
export function Segmented<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string; count?: number }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex items-center bg-[#f2f4f7] rounded-btn p-1 gap-0.5">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors',
            value === o.value ? 'bg-card text-ink shadow-card' : 'text-ink-2 hover:text-ink'
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span className={cn('ml-1.5 text-[11px] font-bold', value === o.value ? 'text-accent' : 'text-ink-3')}>
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ── Modal ───────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, wide }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} style={{ background: 'rgba(17,19,34,0.4)' }}>
      <div className={cn('bg-card rounded-card shadow-pop w-full max-h-[90vh] overflow-y-auto fade-up', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between px-6 pt-5 pb-1 sticky top-0 bg-card z-10">
          <h3 className="text-[17px] font-semibold text-ink m-0">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-3 hover:bg-[#f2f4f7] hover:text-ink transition-colors">
            <X size={17} />
          </button>
        </div>
        <div className="px-6 pb-6 pt-3">{children}</div>
      </div>
    </div>
  )
}

// ── Avatar ──────────────────────────────────────────────────
const AVATAR_COLORS = [
  'bg-accent-soft text-accent',
  'bg-good-soft text-good',
  'bg-warn-soft text-warn',
  'bg-info-soft text-info',
  'bg-grape-soft text-grape',
  'bg-bad-soft text-bad',
]

export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length]
  return (
    <div
      className={cn('rounded-full flex items-center justify-center font-bold shrink-0', color)}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  )
}

// ── Empty state ─────────────────────────────────────────────
export function EmptyState({ icon, title, subtitle, action }: {
  icon?: ReactNode
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      {icon && <div className="w-12 h-12 rounded-2xl bg-accent-soft text-accent flex items-center justify-center mb-3">{icon}</div>}
      <p className="text-[15px] font-semibold text-ink m-0">{title}</p>
      {subtitle && <p className="text-[13px] text-ink-2 mt-1 m-0 max-w-sm">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ── Spinner ─────────────────────────────────────────────────
export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      className="inline-block border-2 border-accent border-t-transparent rounded-full spin"
      style={{ width: size, height: size }}
    />
  )
}

// ── Page header ─────────────────────────────────────────────
export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 className="text-[22px] font-bold text-ink m-0 tracking-tight">{title}</h1>
        {subtitle && <p className="text-[13.5px] text-ink-2 mt-0.5 m-0">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2.5 flex-wrap">{right}</div>}
    </div>
  )
}

// ── Table primitives ────────────────────────────────────────
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cn('text-left text-[12px] font-semibold text-ink-3 uppercase tracking-wide px-4 py-3 border-b border-line whitespace-nowrap', className)}>
      {children}
    </th>
  )
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn('px-4 py-3.5 text-[14px] text-ink border-b border-line align-middle', className)}>{children}</td>
}
