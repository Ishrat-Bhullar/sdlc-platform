/**
 * ArchitectureDiagramViewer.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders Mermaid architecture diagrams from the architecture_diagram artifact.
 * Supports:
 *   - Live diagram preview (rendered via Mermaid)
 *   - Click to enlarge (modal)
 *   - Download PNG (via canvas)
 *   - Download SVG (via serialization)
 *   - Download source (raw Mermaid text)
 *
 * Reuses existing architecture artifact data — does NOT regenerate diagrams.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Maximize2,
  Download,
  Image,
  FileCode,
  X,
  Loader2,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiagramData {
  type: string;
  content: string;
}

interface ArchitectureDiagramViewerProps {
  diagrams: DiagramData[];
  /** Optional class name for the container */
  className?: string;
}

// ─── Mermaid source sanitization ──────────────────────────────────────────────

/**
 * LLM-generated Mermaid source (this project's diagrams are 100% LLM output,
 * never validated before storage) routinely writes bare multi-word node
 * names with no quoting/brackets — e.g. `User-->Claims Intake Service` — and
 * occasionally a malformed edge-label arrow like `-->|Submit Claim|>Target`
 * (an extra trailing `>` after the label's closing pipe). Both are syntax
 * errors Mermaid's parser correctly rejects. Rather than trying to get an
 * LLM to reliably follow strict Mermaid grammar, sanitize simple `A-->B` /
 * `A-->|label|B` edge lines here before rendering. Lines that don't match
 * this exact shape (already-bracketed nodes, subgraph/class/sequence/ER
 * syntax, etc.) pass through untouched.
 */
export function sanitizeMermaidSource(source: string): string {
  const idFor = new Map<string, string>();
  let counter = 0;
  const safeId = (label: string): string => {
    if (idFor.has(label)) return idFor.get(label)!;
    const id = `n${counter++}`;
    idFor.set(label, id);
    return id;
  };

  const edgeLine = /^(\s*)([^-|>[\](){}"\n]+?)\s*-->\s*(?:\|([^|]*)\|>?\s*)?([^-|>[\](){}"\n]+?)\s*$/;

  return source
    .split('\n')
    .map((line) => {
      const m = line.match(edgeLine);
      if (!m) return line;
      const [, indent, rawA, label, rawB] = m;
      const a = rawA.trim();
      const b = rawB.trim();
      const hadTrailingGt = label !== undefined && /\|>\s*\S/.test(line);
      // Even when neither node name needs quoting, a stray `>` right after
      // the label's closing `|` (e.g. `A-->|label|>B`) is still invalid
      // Mermaid syntax and must be stripped — the multi-word-name rewrite
      // below already does this as a side effect, but bail out into that
      // path too when only the `|>` needs fixing.
      if (!a.includes(' ') && !b.includes(' ') && !hadTrailingGt) return line;
      const edge = label !== undefined ? `-->|${label.trim()}|` : '-->';
      const nodeA = a.includes(' ') ? `${safeId(a)}["${a}"]` : a;
      const nodeB = b.includes(' ') ? `${safeId(b)}["${b}"]` : b;
      return `${indent}${nodeA} ${edge} ${nodeB}`;
    })
    .join('\n');
}

// ─── Mermaid rendering helper ─────────────────────────────────────────────────

/**
 * Render Mermaid diagram source to an SVG string using the Mermaid API.
 * Falls back to a text representation if Mermaid is unavailable.
 */
async function renderMermaidToSvg(rawSource: string): Promise<string> {
  const source = sanitizeMermaidSource(rawSource);
  try {
    const mermaid = await import('mermaid');
    // Initialize once
    mermaid.default.initialize({
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        primaryColor: '#1a1a2e',
        primaryTextColor: '#e0e0e0',
        primaryBorderColor: '#333',
        lineColor: '#f0c040',
        secondaryColor: '#16213e',
        tertiaryColor: '#0f3460',
        fontFamily: 'monospace',
      },
      securityLevel: 'loose',
    });
    const { svg } = await mermaid.default.render('mermaid-svg-' + Math.random().toString(36).slice(2), source);
    return svg;
  } catch {
    // Fallback: return a styled text block
    return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300">
      <rect width="600" height="300" fill="#1a1a2e" rx="8"/>
      <text x="20" y="30" fill="#f0c040" font-family="monospace" font-size="12">${escapeXml(source.slice(0, 200))}</text>
      <text x="20" y="280" fill="#888" font-family="monospace" font-size="10">Mermaid render unavailable — showing source</text>
    </svg>`;
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
}

// ─── Download helpers ─────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function downloadSvg(svgElement: SVGSVGElement, filename: string) {
  const clone = svgElement.cloneNode(true) as SVGSVGElement;
  // Ensure proper namespace
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(clone);
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, filename);
}

async function downloadPng(svgElement: SVGSVGElement, filename: string) {
  const svgData = new XMLSerializer().serializeToString(svgElement);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const img = document.createElement('img');
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  img.onload = () => {
    canvas.width = img.width * 2;
    canvas.height = img.height * 2;
    ctx.scale(2, 2);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, filename);
    }, 'image/png');
  };
  img.src = url;
}

function downloadSource(source: string, filename: string) {
  const blob = new Blob([source], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, filename);
}

// ─── Single diagram card ──────────────────────────────────────────────────────

function DiagramCard({
  diagram,
  index,
  onEnlarge,
}: {
  diagram: DiagramData;
  index: number;
  onEnlarge: (svg: SVGSVGElement, title: string, source: string) => void;
}) {
  const svgRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    renderMermaidToSvg(diagram.content).then((svgStr) => {
      if (cancelled || !svgRef.current) return;
      svgRef.current.innerHTML = svgStr;
      setRendered(true);
    }).catch((e) => {
      if (!cancelled) setError(e.message || 'Render failed');
    });
    return () => { cancelled = true; };
  }, [diagram.content]);

  const handleEnlarge = () => {
    const svg = svgRef.current?.querySelector('svg');
    if (svg) onEnlarge(svg as SVGSVGElement, diagram.type, diagram.content);
  };

  const handleDownloadSvg = () => {
    const svg = svgRef.current?.querySelector('svg');
    if (svg) downloadSvg(svg as SVGSVGElement, `diagram_${diagram.type}.svg`);
  };

  const handleDownloadPng = () => {
    const svg = svgRef.current?.querySelector('svg');
    if (svg) downloadPng(svg as SVGSVGElement, `diagram_${diagram.type}.png`);
  };

  const handleDownloadSource = () => {
    downloadSource(diagram.content, `diagram_${diagram.type}.mmd`);
  };

  return (
    <div className="rounded-lg border border-dark-border bg-dark-bg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-dark-border">
        <span className="text-xs font-medium text-text-primary capitalize">
          {diagram.type.replace(/_/g, ' ')}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleEnlarge}
            disabled={!rendered}
            className="p-1 rounded hover:bg-dark-surface text-text-muted hover:text-ey-yellow transition-colors disabled:opacity-30"
            title="Enlarge"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleDownloadSvg}
            disabled={!rendered}
            className="p-1 rounded hover:bg-dark-surface text-text-muted hover:text-ey-yellow transition-colors disabled:opacity-30"
            title="Download SVG"
          >
            <FileCode className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleDownloadPng}
            disabled={!rendered}
            className="p-1 rounded hover:bg-dark-surface text-text-muted hover:text-ey-yellow transition-colors disabled:opacity-30"
            title="Download PNG"
          >
            <Image className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleDownloadSource}
            className="p-1 rounded hover:bg-dark-surface text-text-muted hover:text-ey-yellow transition-colors"
            title="Download Source"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Diagram body */}
      <div className="p-3">
        {!rendered && !error && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-ey-yellow" />
          </div>
        )}
        {error && (
          <div className="text-xs text-status-error py-4 text-center">
            Failed to render diagram: {error}
          </div>
        )}
        <div
          ref={svgRef}
          className="w-full overflow-auto cursor-pointer hover:opacity-90 transition-opacity"
          style={{ maxHeight: '240px' }}
          onClick={handleEnlarge}
        />
      </div>
    </div>
  );
}

// ─── Enlarged modal ───────────────────────────────────────────────────────────

function EnlargedModal({
  svgElement,
  title,
  source,
  onClose,
}: {
  svgElement: SVGSVGElement | null;
  title: string;
  source: string;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !svgElement) return;
    containerRef.current.innerHTML = '';
    const clone = svgElement.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('width', '100%');
    clone.setAttribute('height', 'auto');
    clone.style.maxWidth = '100%';
    containerRef.current.appendChild(clone);
  }, [svgElement]);

  const handleDownloadSvg = () => {
    const svg = containerRef.current?.querySelector('svg');
    if (svg) downloadSvg(svg as SVGSVGElement, `diagram_${title}.svg`);
  };

  const handleDownloadPng = () => {
    const svg = containerRef.current?.querySelector('svg');
    if (svg) downloadPng(svg as SVGSVGElement, `diagram_${title}.png`);
  };

  const handleDownloadSource = () => {
    downloadSource(source, `diagram_${title}.mmd`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative max-w-4xl w-full mx-4 max-h-[90vh] overflow-auto rounded-xl border border-dark-border bg-dark-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary capitalize">
            {title.replace(/_/g, ' ')}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadSvg}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-text-muted hover:text-ey-yellow hover:bg-dark-bg transition-colors"
            >
              <FileCode className="h-3 w-3" /> SVG
            </button>
            <button
              onClick={handleDownloadPng}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-text-muted hover:text-ey-yellow hover:bg-dark-bg transition-colors"
            >
              <Image className="h-3 w-3" /> PNG
            </button>
            <button
              onClick={handleDownloadSource}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-text-muted hover:text-ey-yellow hover:bg-dark-bg transition-colors"
            >
              <Download className="h-3 w-3" /> Source
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-dark-bg text-text-muted hover:text-text-primary transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Diagram */}
        <div ref={containerRef} className="w-full overflow-auto bg-dark-bg rounded-lg p-4" />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ArchitectureDiagramViewer({ diagrams, className = '' }: ArchitectureDiagramViewerProps) {
  const [enlarged, setEnlarged] = useState<{
    svg: SVGSVGElement | null;
    title: string;
    source: string;
  } | null>(null);

  if (!diagrams || diagrams.length === 0) {
    return (
      <div className={`rounded-lg border border-dark-border bg-dark-bg px-4 py-6 text-center ${className}`}>
        <p className="text-xs text-text-muted">No architecture diagrams available.</p>
      </div>
    );
  }

  return (
    <>
      <div className={`space-y-3 ${className}`}>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-xs font-semibold text-text-primary">Architecture Diagrams</h3>
          <span className="text-[10px] text-text-muted">({diagrams.length} diagram{diagrams.length > 1 ? 's' : ''})</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {diagrams.map((d, i) => (
            <DiagramCard
              key={`${d.type}-${i}`}
              diagram={d}
              index={i}
              onEnlarge={(svg, title, source) => setEnlarged({ svg, title, source })}
            />
          ))}
        </div>
      </div>

      {enlarged && (
        <EnlargedModal
          svgElement={enlarged.svg}
          title={enlarged.title}
          source={enlarged.source}
          onClose={() => setEnlarged(null)}
        />
      )}
    </>
  );
}

export default ArchitectureDiagramViewer;