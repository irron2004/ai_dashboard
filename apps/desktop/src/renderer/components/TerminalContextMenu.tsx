import { useEffect } from 'react'

type Props = {
  x: number
  y: number
  canCopy: boolean
  onCopy: () => void
  onPaste: () => void
  onClose: () => void
}

export function TerminalContextMenu({ x, y, canCopy, onCopy, onPaste, onClose }: Props) {
  useEffect(() => {
    const close = () => onClose()
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', escape)
    }
  }, [onClose])

  return (
    <div
      className="terminal-context-menu"
      role="menu"
      aria-label="Terminal 메뉴"
      style={{ position: 'fixed', zIndex: 140, left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" disabled={!canCopy} onClick={() => { onCopy(); onClose() }}>Copy</button>
      <button type="button" role="menuitem" onClick={() => { onPaste(); onClose() }}>Paste</button>
    </div>
  )
}
