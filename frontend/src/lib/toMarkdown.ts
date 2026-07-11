/**
 * toMarkdown.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Generic, honest JSON → Markdown serializer for artifact "Export Markdown"
 * buttons. Several workspaces previously downloaded raw JSON content under a
 * `.md` filename regardless of the requested format — this actually converts
 * the real artifact data into readable Markdown instead.
 */

function titleCase(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderValue(value: unknown, depth: number): string {
  if (value === null || value === undefined || value === '') return '';

  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    return value
      .map((item) => {
        if (typeof item === 'object' && item !== null) {
          const inner = renderObjectAsBullets(item as Record<string, unknown>);
          return `- ${inner}`;
        }
        return `- ${String(item)}`;
      })
      .join('\n');
  }

  if (typeof value === 'object') {
    return renderObjectAsBullets(value as Record<string, unknown>);
  }

  return String(value);
}

function renderObjectAsBullets(obj: Record<string, unknown>): string {
  const parts = Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => {
      if (typeof v === 'object') {
        const nested = renderValue(v, 1).split('\n').map((l) => `  ${l}`).join('\n');
        return `**${titleCase(k)}**:\n${nested}`;
      }
      return `**${titleCase(k)}**: ${String(v)}`;
    });
  return parts.join('; ');
}

/**
 * Converts a real generated-artifact object into Markdown: one H2 section
 * per top-level field, bullet lists for arrays, nested key/value pairs for
 * objects. No fabricated content — sections with no data are simply omitted.
 */
export function artifactToMarkdown(title: string, data: Record<string, unknown>): string {
  const lines: string[] = [`# ${title}`, ''];

  for (const [key, value] of Object.entries(data)) {
    const rendered = renderValue(value, 0);
    if (!rendered) continue;
    lines.push(`## ${titleCase(key)}`, '', rendered, '');
  }

  return lines.join('\n');
}
