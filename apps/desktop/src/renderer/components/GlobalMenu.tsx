import { useEffect, useRef, useState } from 'react'

export type GlobalMenuItem = { label: string; onClick: () => void; disabled?: boolean }

/** Top-right ⋯ overflow menu for rarely-used global actions (app update 등). */
export function GlobalMenu({ items }: { items: GlobalMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="global-menu" ref={ref}>
      <button type="button" aria-label="메뉴" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>⋯</button>
      {open && (
        <div className="global-menu__list" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="global-menu__item"
              disabled={item.disabled}
              // `disabled` blocks click in browsers but not in fireEvent tests — guard is intentional
              onClick={() => { if (!item.disabled) { item.onClick(); setOpen(false) } }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
