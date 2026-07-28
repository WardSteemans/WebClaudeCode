import { useEffect, useRef, useState } from 'react';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  dividerAfter?: boolean;
  submenu?: ContextMenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (openSubmenu !== null) setOpenSubmenu(null); else onClose(); }
    };
    // Delay so the same click that opened it doesn't close it
    requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('keydown', handleKey);
    });
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose, openSubmenu]);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const menu = menuRef.current;
    if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-44 py-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl shadow-black/30 text-[13px]"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => (
        <div key={i} className="relative">
          <button
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors
              ${item.disabled
                ? 'text-[var(--color-text-muted)] cursor-not-allowed opacity-50'
                : item.danger
                ? 'text-red-500 hover:bg-red-500/10'
                : 'text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'
              }`}
            onClick={() => {
              if (item.disabled) return;
              if (item.submenu) {
                setOpenSubmenu(openSubmenu === i ? null : i);
              } else {
                item.onClick();
                onClose();
              }
            }}
            onMouseEnter={() => {
              if (item.submenu) setOpenSubmenu(i);
            }}
          >
            {item.icon ? (
              <span className="w-4 h-4 flex items-center justify-center shrink-0">{item.icon}</span>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <span className="flex-1 truncate">{item.label}</span>
            {item.submenu && <span className="text-[10px] text-[var(--color-text-muted)] ml-2">▶</span>}
            {item.shortcut && <span className="text-[10px] text-[var(--color-text-muted)] ml-4">{item.shortcut}</span>}
          </button>

          {/* Submenu */}
          {item.submenu && openSubmenu === i && (
            <div
              className="absolute top-0 left-full ml-1 min-w-40 py-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl shadow-black/30 text-[13px] z-50"
            >
              {item.submenu.map((sub, j) => (
                <button
                  key={j}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors
                    ${sub.disabled
                      ? 'text-[var(--color-text-muted)] cursor-not-allowed opacity-50'
                      : sub.danger
                      ? 'text-red-500 hover:bg-red-500/10'
                      : 'text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'
                    }`}
                  onClick={() => { if (!sub.disabled) { sub.onClick(); onClose(); } }}
                >
                  <span className="flex-1 truncate">{sub.label}</span>
                </button>
              ))}
            </div>
          )}

          {item.dividerAfter && <div className="mx-2 my-1 border-t border-[var(--color-border)]" />}
        </div>
      ))}
    </div>
  );
}
