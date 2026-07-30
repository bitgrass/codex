"use client"

import React, { Fragment, useEffect } from "react"

/** Small "i" badge with the hover tooltip used all over the portal. */
export function InfoTip({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`inline-flex relative group align-middle ${className}`}>
      <i className="ri-information-line text-primary text-[0.95rem] leading-none cursor-help"></i>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-[60] mb-2 hidden w-[16rem] -translate-x-1/2 rounded-md bg-bodybg2 px-3 py-2 text-xs font-normal leading-snug text-defaulttextcolor shadow-lg ring-1 ring-defaultborder/60 group-hover:block dark:bg-bodybg2">
        {text}
      </span>
    </span>
  )
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  width = "max-w-[34rem]",
}: {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: React.ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 p-4 py-10 backdrop-blur-[2px]">
      <div
        className={`relative w-full ${width} rounded-xl border border-defaultborder/50 bg-bodybg2 shadow-2xl dark:border-white/10`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute end-4 top-4 z-10 text-lg text-textmuted transition hover:text-defaulttextcolor"
        >
          <i className="ri-close-line"></i>
        </button>
        <div className="p-6">
          {title ? <h5 className="mb-2 text-center text-xl font-semibold">{title}</h5> : null}
          {description ? (
            <p className="mx-auto mb-5 max-w-[26rem] text-center text-sm text-textmuted">{description}</p>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  )
}

export function Field({
  label,
  tip,
  children,
  hint,
  error,
}: {
  label: string
  tip?: string
  children: React.ReactNode
  hint?: string
  error?: string | null
}) {
  return (
    <div className="mb-4">
      <label className="mb-2 flex items-center gap-1.5 text-sm text-defaulttextcolor">
        {label}
        {tip ? <InfoTip text={tip} /> : null}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      {!error && hint ? <p className="mt-1 text-xs text-textmuted">{hint}</p> : null}
    </div>
  )
}

/** Input with a trailing unit chip (BTG / days / %), as in the third party forms. */
export function UnitInput({
  value,
  onChange,
  unit,
  placeholder,
  type = "text",
  disabled,
  action,
}: {
  value: string
  onChange?: (value: string) => void
  unit?: string
  placeholder?: string
  type?: string
  disabled?: boolean
  action?: React.ReactNode
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-md border border-inputborder bg-primary/[0.04] px-3 py-2.5 focus-within:border-primary/60 dark:bg-white/[0.03] ${
        disabled ? "opacity-70" : ""
      }`}
    >
      <input
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange?.(event.target.value)}
        className="w-full border-0 bg-transparent p-0 text-sm text-defaulttextcolor outline-none placeholder:text-textmuted focus:ring-0"
      />
      {unit ? <span className="whitespace-nowrap text-sm font-medium text-textmuted">{unit}</span> : null}
      {action}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? "bg-primary" : "bg-primary/20 dark:bg-white/20"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          checked ? "start-[1.4rem]" : "start-0.5"
        }`}
      ></span>
    </button>
  )
}

export function StatTile({
  icon,
  label,
  value,
  sub,
  tip,
}: {
  icon: string
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tip?: string
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm text-textmuted">
        <i className={`${icon} text-primary`}></i>
        {label}
        {tip ? <InfoTip text={tip} /> : null}
      </div>
      <div className="text-2xl font-semibold leading-tight">{value}</div>
      {sub ? <div className="mt-1 text-xs text-textmuted">{sub}</div> : null}
    </div>
  )
}

export function StatusBadge({
  status,
}: {
  status: "active" | "expired" | "closed" | "funded" | "underfunded" | "unlocked" | "locked"
}) {
  const map = {
    active: { text: "Active", icon: "ri-time-line", cls: "text-primary ring-primary/40 bg-primary/10" },
    closed: { text: "Closed", icon: "ri-lock-line", cls: "text-warning ring-warning/40 bg-warning/10" },
    expired: { text: "Expired", icon: "ri-close-circle-line", cls: "text-textmuted ring-defaultborder bg-light/60" },
    funded: { text: "Fully funded", icon: "ri-checkbox-circle-line", cls: "text-primary ring-primary/40 bg-primary/10" },
    underfunded: { text: "Underfunded", icon: "ri-error-warning-line", cls: "text-danger ring-danger/40 bg-danger/10" },
    unlocked: { text: "Unlocked", icon: "ri-lock-unlock-line", cls: "text-primary ring-primary/40 bg-primary/10" },
    locked: { text: "Locked", icon: "ri-lock-line", cls: "text-warning ring-warning/40 bg-warning/10" },
  } as const
  const item = map[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${item.cls}`}>
      <i className={item.icon}></i>
      {item.text}
    </span>
  )
}

export function ProgressBar({ ratio, className = "" }: { ratio: number; className?: string }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-defaultborder dark:bg-white/10 ${className}`}>
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
      ></div>
    </div>
  )
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  loading,
  type = "button",
  className = "",
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  type?: "button" | "submit"
  className?: string
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-primary/40 ${className}`}
    >
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span> : null}
      {children}
    </button>
  )
}

export function GhostButton({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex w-full items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "danger"; children: React.ReactNode }) {
  const cls =
    tone === "danger"
      ? "border-danger/40 bg-danger/10 text-danger"
      : tone === "warning"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-primary/30 bg-primary/[0.06] text-defaulttextcolor"
  return <div className={`rounded-md border px-4 py-3 text-xs leading-relaxed ${cls}`}>{children}</div>
}

export function AddressLink({ address, label }: { address: string; label?: string }) {
  return (
    <a
      href={`https://basescan.org/address/${address}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 font-medium text-defaulttextcolor hover:text-primary"
    >
      {label ?? address}
      <i className="ri-external-link-line text-xs text-primary"></i>
    </a>
  )
}

export function Rows({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-defaultborder/60 dark:divide-white/5">{children}</div>
}

export function Row({ label, value, tip }: { label: string; value: React.ReactNode; tip?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="flex items-center gap-1.5 text-textmuted">
        {label}
        {tip ? <InfoTip text={tip} /> : null}
      </span>
      <span className="text-end font-medium">{value}</span>
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-14 text-center">
      <p className="font-semibold">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-[28rem] text-sm text-textmuted">{hint}</p> : null}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="py-14 text-center">
      <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
      {label ? <p className="mt-4 text-sm text-textmuted">{label}</p> : null}
    </div>
  )
}

export const Noop = Fragment
