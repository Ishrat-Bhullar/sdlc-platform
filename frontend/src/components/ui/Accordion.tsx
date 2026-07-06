import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';

interface AccordionProps {
  children: ReactNode;
  className?: string;
}

/** Container for a stack of AccordionItems — just spacing, no shared state. */
export function Accordion({ children, className = '' }: AccordionProps) {
  return <div className={`space-y-2 ${className}`}>{children}</div>;
}

interface AccordionItemProps {
  title: string;
  icon?: LucideIcon;
  badge?: ReactNode;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** Single collapsible section — visually matches RequirementCard's expand
 * pattern (chevron, dark-bg summary row, dark-surface detail panel) so new
 * accordion content looks native rather than bolted on. Concise by default
 * (collapsed unless defaultOpen), full detail on expand. */
export function AccordionItem({ title, icon: Icon, badge, subtitle, defaultOpen = false, children }: AccordionItemProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg bg-dark-bg overflow-hidden border border-dark-border">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-dark-cardHover transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? (
            <ChevronDown className="h-4 w-4 text-text-muted flex-shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-text-muted flex-shrink-0" />
          )}
          {Icon && <Icon className="h-4 w-4 text-ey-yellow flex-shrink-0" />}
          <span className="text-sm font-medium text-text-primary truncate">{title}</span>
          {subtitle && <span className="text-xs text-text-muted truncate hidden sm:inline">{subtitle}</span>}
        </div>
        {badge && <div className="flex-shrink-0">{badge}</div>}
      </button>
      {open && (
        <div className="border-t border-dark-border p-4 bg-dark-surface/30">
          {children}
        </div>
      )}
    </div>
  );
}

/** Lightweight jump-to-section nav for long accordion stacks — renders as a
 * row of pill buttons that scroll the matching AccordionItem into view. */
export function AccordionTOC({ items, onJump }: { items: string[]; onJump: (index: number) => void }) {
  if (items.length < 3) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {items.map((label, i) => (
        <button
          key={i}
          onClick={() => onJump(i)}
          className="text-[11px] px-2 py-1 rounded-full bg-dark-bg border border-dark-border text-text-muted hover:text-ey-yellow hover:border-ey-yellow/40 transition-colors"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Reusable bullet list — same visual style as RequirementsWorkspace's BulletList. */
export function BulletList({ items }: { items?: string[] }) {
  if (!items || items.length === 0) return <p className="text-xs text-text-muted">—</p>;
  return (
    <ul className="space-y-1">
      {items.map((it, i) => (
        <li key={i} className="text-xs text-text-secondary leading-relaxed flex gap-1.5">
          <span className="text-ey-yellow mt-0.5">•</span><span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

/** Generic key/value or row-object table renderer for structured accordion content. */
export function DataTable({ columns, rows }: { columns: string[]; rows: Array<Record<string, ReactNode>> }) {
  if (!rows || rows.length === 0) return <p className="text-xs text-text-muted">—</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-dark-border">
            {columns.map((c) => (
              <th key={c} className="text-left font-medium text-text-muted pb-2 pr-4 whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-dark-border/50">
              {columns.map((c) => (
                <td key={c} className="py-2 pr-4 text-text-secondary align-top">{row[c] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
