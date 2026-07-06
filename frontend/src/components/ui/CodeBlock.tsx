import { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
  maxHeight?: string;
}

/** Syntax-highlighted code/DDL/YAML/JSON block matching the app's dark theme,
 * with a copy-to-clipboard affordance. Used inside accordion sections for any
 * code-shaped field (SQL DDL, OpenAPI YAML, sample payloads, snippets). */
export function CodeBlock({ code, language = 'text', maxHeight = '400px' }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — no-op
    }
  };

  return (
    <div className="relative rounded-lg border border-dark-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-dark-card border-b border-dark-border">
        <span className="text-[10px] uppercase tracking-wide text-text-muted font-mono">{language}</span>
        <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] text-text-muted hover:text-ey-yellow transition-colors">
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div style={{ maxHeight, overflow: 'auto' }}>
        <SyntaxHighlighter
          language={language}
          style={vscDarkPlus}
          customStyle={{ margin: 0, background: '#0A0A0A', fontSize: '12px', padding: '12px' }}
          wrapLongLines
        >
          {code || ''}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
