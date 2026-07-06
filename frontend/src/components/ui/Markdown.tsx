import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface MarkdownProps {
  content: string;
  className?: string;
}

/** Renders LLM-produced markdown (guides, BRD/SRS text, etc.) as sanitized HTML,
 * styled to match the app's dark theme via scoped child selectors (no
 * @tailwindcss/typography plugin is installed, so headings/tables/code are
 * styled directly here instead of via `prose` classes). */
export function Markdown({ content, className = '' }: MarkdownProps) {
  const html = useMemo(() => {
    if (!content) return '';
    const raw = marked.parse(content, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [content]);

  if (!content) return <p className="text-xs text-text-muted">—</p>;

  return (
    <div
      className={`text-sm text-text-secondary leading-relaxed space-y-3
        [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-text-primary [&_h1]:mt-4 [&_h1]:mb-2
        [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-text-primary [&_h2]:mt-4 [&_h2]:mb-2
        [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-ey-yellow [&_h3]:mt-3 [&_h3]:mb-1
        [&_p]:mb-2
        [&_ul]:list-disc [&_ul]:list-inside [&_ul]:space-y-1 [&_ul]:mb-2
        [&_ol]:list-decimal [&_ol]:list-inside [&_ol]:space-y-1 [&_ol]:mb-2
        [&_li]:text-xs [&_li]:text-text-secondary
        [&_table]:w-full [&_table]:text-xs [&_table]:my-2
        [&_th]:text-left [&_th]:text-text-muted [&_th]:font-medium [&_th]:border-b [&_th]:border-dark-border [&_th]:pb-1 [&_th]:pr-3
        [&_td]:text-text-secondary [&_td]:border-b [&_td]:border-dark-border/50 [&_td]:py-1 [&_td]:pr-3 [&_td]:align-top
        [&_code]:font-mono [&_code]:text-[11px] [&_code]:bg-dark-bg [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-ey-yellow
        [&_pre]:bg-dark-bg [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:my-2
        [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-text-secondary
        [&_blockquote]:border-l-2 [&_blockquote]:border-ey-yellow/40 [&_blockquote]:pl-3 [&_blockquote]:text-text-muted [&_blockquote]:italic
        [&_a]:text-ey-yellow [&_a]:underline
        [&_strong]:text-text-primary [&_strong]:font-semibold
        ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
