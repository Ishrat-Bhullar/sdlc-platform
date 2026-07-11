import { Layers, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import type { UIUXDesignSystem } from '../../types/unified';

interface DesignSystemManagerProps {
  designSystem: UIUXDesignSystem;
}

// Ported from Bhumika's design-tokens registry panel. Retyped from her
// fixed named-palette lookup (DesignTokens) to the real backend DesignSystem
// schema — swatches/typography/spacing are now the agent's actual generated
// tokens, not a hardcoded per-preset table.
export function DesignSystemManager({ designSystem }: DesignSystemManagerProps) {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const swatches = [
    ...(designSystem.colorPalette?.primary || []),
    ...(designSystem.colorPalette?.neutral || []),
    ...(designSystem.colorPalette?.semantic || []),
  ];

  const handleCopy = (section: string, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const primary = designSystem.colorPalette?.primary || [];
  const neutral = designSystem.colorPalette?.neutral || [];

  const tailwindThemeCode = `{
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '${primary[0]?.hex || '#FFE600'}',
          surface: '${neutral[0]?.hex || '#111827'}',
        }
      },
      fontFamily: {
        sans: ['${designSystem.typography?.fontFamily || 'Inter'}'],
        heading: ['${designSystem.typography?.headingFont || 'Inter'}'],
      },
      spacing: {
        base: '${designSystem.spacing?.baseUnit || '8px'}'
      }
    }
  }
}`;

  return (
    <div className="bg-dark-card border border-dark-border rounded-2xl p-5 space-y-6 shadow-xl">
      <div className="flex items-center justify-between border-b border-dark-border pb-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4.5 w-4.5 text-ey-yellow" />
          <h3 className="text-xs font-black uppercase tracking-wider text-text-primary">Design Tokens Registry</h3>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-dark-bg border border-dark-border rounded-xl p-4 space-y-3">
          <span className="text-[9px] font-mono font-bold text-ey-yellow uppercase tracking-widest block">Color Tokens</span>
          <div className="grid grid-cols-1 gap-2 max-h-[220px] overflow-y-auto">
            {swatches.length === 0 && <p className="text-[10px] text-text-muted">No color tokens generated yet.</p>}
            {swatches.map((col, idx) => (
              <div key={`${col.name}-${idx}`} className="p-2 bg-dark-cardHover border border-dark-border rounded-lg flex items-center gap-3">
                <span className="h-7 w-7 rounded-md border border-dark-border shrink-0" style={{ backgroundColor: col.hex }} />
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-bold text-text-primary block truncate leading-tight">{col.name}</span>
                  <span className="font-mono text-[8px] text-text-muted block mt-0.5">{col.hex} · {col.usage}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-dark-bg border border-dark-border rounded-xl p-4 space-y-3.5">
          <span className="text-[9px] font-mono font-bold text-ey-yellow uppercase tracking-widest block">Typography</span>
          <div className="space-y-3.5 text-xs">
            <div className="border-b border-dark-border/60 pb-2">
              <span className="text-[8px] text-text-muted block font-mono">Heading — {designSystem.typography?.headingFont || 'Inter'}</span>
              <span className="text-sm font-black text-text-primary block mt-0.5" style={{ fontFamily: designSystem.typography?.headingFont }}>Sample Heading</span>
            </div>
            <div className="border-b border-dark-border/60 pb-2">
              <span className="text-[8px] text-text-muted block font-mono">Body — {designSystem.typography?.fontFamily || 'Inter'}</span>
              <p className="text-[11px] text-text-secondary leading-relaxed mt-0.5" style={{ fontFamily: designSystem.typography?.fontFamily }}>The quick brown fox jumps over the lazy dog.</p>
            </div>
            {Object.entries(designSystem.typography?.scale || {}).slice(0, 3).map(([k, v]) => (
              <div key={k}>
                <span className="text-[8px] text-text-muted block font-mono">{k}</span>
                <span className="font-mono text-[9px] text-ey-yellow block mt-0.5">{v}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 bg-dark-bg border border-dark-border rounded-xl p-4 relative">
          <div className="flex items-center justify-between border-b border-dark-border/60 pb-1.5">
            <span className="text-[9px] font-mono font-bold text-ey-yellow uppercase tracking-widest block">Spacing Scale</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(designSystem.spacing?.scale || []).map((s) => (
              <span key={s} className="text-[9px] font-mono bg-dark-cardHover border border-dark-border text-text-secondary px-2 py-1 rounded">{s}</span>
            ))}
          </div>
          <p className="text-[9px] text-text-muted leading-relaxed">{designSystem.spacing?.rationale}</p>
        </div>
      </div>

      <div className="bg-dark-bg border border-dark-border rounded-xl p-4.5 space-y-3 relative">
        <div className="flex items-center justify-between border-b border-dark-border/60 pb-2">
          <span className="font-bold text-text-primary text-[10px] uppercase">Tailwind Configuration</span>
          <button onClick={() => handleCopy('tailwind', tailwindThemeCode)} className="text-text-muted hover:text-white">
            {copiedSection === 'tailwind' ? <Check size={12} className="text-status-success" /> : <Copy size={12} />}
          </button>
        </div>
        <pre className="text-[9px] bg-black/40 p-3 rounded-xl border border-dark-border text-text-muted font-mono max-h-[140px] overflow-y-auto select-all">{tailwindThemeCode}</pre>
      </div>

      {designSystem.designPrinciples?.length > 0 && (
        <div className="bg-dark-bg border border-dark-border rounded-xl p-4 space-y-2">
          <span className="text-[9px] font-mono font-bold text-ey-yellow uppercase tracking-widest block">Design Principles</span>
          <ul className="space-y-1.5 text-[10px] text-text-secondary list-disc list-inside">
            {designSystem.designPrinciples.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
