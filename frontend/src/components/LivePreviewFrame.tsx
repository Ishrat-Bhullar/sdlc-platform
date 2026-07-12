import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface PreviewFile {
  path: string;
  name: string;
  content: string;
  language: string;
}

interface LivePreviewFrameProps {
  files: PreviewFile[];
}

// The sandbox has no bundler or module resolver — it only ever loads
// React/ReactDOM (as UMD globals, see the injected HTML below). A generated
// entry file that imports a sibling local component (the normal case once
// an app is broken into real components, not a one-off) is handled by
// inlining that file's source directly rather than rejecting the whole
// preview — see resolveAndInline() below. Anything that isn't React itself
// or a resolvable local file (a real npm package) is still outside what
// this mechanism can do, and falls back to the graceful error state.
// axios is included alongside React/ReactDOM because it's the single most
// common HTTP client generated frontend code calls a backend through — its
// UMD build assigns the same `axios` global that `import axios from 'axios'`
// resolves to, so no special-casing is needed beyond loading the script.
//
// react-hook-form has no UMD/CDN build (it's bundler-only), so instead of a
// CDN script it gets a minimal same-name `useForm()` global defined directly
// in the iframe script below (see FORM_POLYFILL) — just enough of its API
// (register/handleSubmit/errors) for a generated form to render and submit
// in the sandbox, not a faithful reimplementation.
//
// recharts is included for chart-bearing generated apps (weather trends,
// banking/spend dashboards, currency-rate history). Verified against this
// exact sandbox (sandboxed iframe, UMD globals, no bundler) before wiring
// in — two real constraints apply, both enforced in the prompt that tells
// the LLM it's allowed to use this library (agents/frontend/prompts.py):
//   1. prop-types MUST load before the recharts script tag, or the
//      `Recharts` global itself never gets defined (verified: omitting it
//      throws "Recharts is not defined", not a lazier prop-types warning).
//   2. <ResponsiveContainer> renders nothing in this sandbox — its
//      ResizeObserver-based measurement never resolves here (verified: 0
//      SVG elements after render). Charts must use a fixed pixel
//      width/height instead (verified working that way).
const ALLOWED_IMPORT_SPECIFIERS = new Set(['react', 'react-dom', 'axios', 'react-hook-form', 'recharts']);
const REACT_CDN = 'https://unpkg.com/react@18/umd/react.production.min.js';
const REACT_DOM_CDN = 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js';
const AXIOS_CDN = 'https://unpkg.com/axios@1/dist/axios.min.js';
const PROP_TYPES_CDN = 'https://unpkg.com/prop-types@15/prop-types.min.js';
const RECHARTS_CDN = 'https://unpkg.com/recharts@2/umd/Recharts.js';

// A minimal same-name shim for react-hook-form's `useForm()` — covers the
// common pattern generated code uses (`register`, `handleSubmit`, `errors`/
// `formState.errors`), backed by a plain ref instead of react-hook-form's
// real uncontrolled-input machinery. Good enough to render and submit in
// the preview sandbox; not a substitute for the real library.
const FORM_POLYFILL = `
function useForm() {
  var storeRef = React.useRef({});
  var errors = {};
  function register(name) {
    return {
      name: name,
      onChange: function (e) { storeRef.current[name] = e && e.target ? e.target.value : e; },
      onBlur: function () {},
    };
  }
  function handleSubmit(onValid) {
    return function (e) {
      if (e && e.preventDefault) e.preventDefault();
      onValid(storeRef.current);
    };
  }
  function setValue(name, value) { storeRef.current[name] = value; }
  function watch() { return storeRef.current; }
  return { register: register, handleSubmit: handleSubmit, errors: errors, formState: { errors: errors }, watch: watch, setValue: setValue };
}
`;

function pickEntryFile(files: PreviewFile[]): PreviewFile | null {
  if (!files.length) return null;
  const byName = (name: string) => files.find((f) => f.name.toLowerCase() === name);
  // Generated React files commonly use a plain .js extension even when the
  // content is JSX (seen in practice) — so the fallback below matches any
  // JS-family file, not just .tsx/.jsx, and picks the one that actually
  // looks like a component (contains JSX-like markup), preferring the
  // largest such file as the most likely top-level page/entry.
  const looksLikeComponent = (content: string) => /<[A-Za-z][\s\S]*?>/.test(content) && /return\s*\(/.test(content);
  return (
    byName('app.tsx') || byName('app.jsx') || byName('app.js') ||
    [...files]
      .filter((f) => /\.(tsx|jsx|js)$/i.test(f.name) && looksLikeComponent(f.content))
      .sort((a, b) => b.content.length - a.content.length)[0] ||
    null
  );
}

// Strips import/export statements (the sandbox has no module resolver) and
// splits import specifiers into relative (local, e.g. "./components/Foo" —
// resolvable by inlining a sibling generated file) vs. everything else (a
// real npm package, unsupported unless it's on the CDN allowlist above).
//
// `__PreviewEntry__` aliasing only applies to the top-level entry file:
// every generated component file typically has its own `export default`,
// and once multiple files are concatenated into one script (see
// resolveAndInline below), aliasing every one of them to the same
// `__PreviewEntry__` name would redeclare it and throw a SyntaxError. A
// dependency file's default export is dropped outright instead — the
// component it refers to is already usable by its own name from earlier in
// that same file (e.g. `const Foo = () => {...}; export default Foo;`).
function parseModuleSyntax(source: string, isEntry: boolean): { code: string; localSpecs: string[]; externalSpecs: string[] } {
  const localSpecs: string[] = [];
  const externalSpecs: string[] = [];
  let code = source.replace(/^\s*import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_match, spec: string) => {
    if (spec.startsWith('.')) localSpecs.push(spec);
    else if (!ALLOWED_IMPORT_SPECIFIERS.has(spec)) externalSpecs.push(spec);
    return '';
  });
  code = code.replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/export\s+default\s+function\s+(\w+)/, 'function $1');
  code = isEntry
    ? code.replace(/export\s+default\s+/, 'const __PreviewEntry__ = ')
    : code.replace(/^\s*export\s+default\s+\w+;\s*$/gm, '');
  code = code.replace(/^\s*export\s+(const|function|class)\s+/gm, '$1 ');
  return { code, localSpecs, externalSpecs };
}

function specBaseName(spec: string): string {
  const parts = spec.split('/');
  return parts[parts.length - 1].replace(/\.(tsx|jsx|ts|js)$/i, '');
}

function findLocalFile(files: PreviewFile[], spec: string): PreviewFile | undefined {
  const base = specBaseName(spec).toLowerCase();
  return files.find((f) => f.name.replace(/\.(tsx|jsx|ts|js)$/i, '').toLowerCase() === base);
}

// Recursively inlines the entry file's local sibling-component imports
// (dependencies first) into one combined source, so the generated app's
// real component tree — not just a single flat file — can render in the
// sandbox. Only a local import that can't be matched to any generated file,
// or a genuine external package import, is reported back as unresolved.
function resolveAndInline(entry: PreviewFile, files: PreviewFile[]): { combinedCode: string; unresolved: string[] } {
  const visited = new Set<string>();
  const blocks: string[] = [];
  const unresolved: string[] = [];

  function visit(file: PreviewFile) {
    if (visited.has(file.name)) return;
    visited.add(file.name);
    const { code, localSpecs, externalSpecs } = parseModuleSyntax(file.content, file.name === entry.name);
    unresolved.push(...externalSpecs);
    for (const spec of localSpecs) {
      const dep = findLocalFile(files, spec);
      if (dep) visit(dep);
      else unresolved.push(spec);
    }
    blocks.push(code);
  }

  visit(entry);
  return { combinedCode: blocks.join('\n\n'), unresolved };
}

export function LivePreviewFrame({ files }: LivePreviewFrameProps) {
  const [error, setError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // `files` arrives freshly parsed (JSON.parse'd from the artifact) on every
  // render of the parent — a new array/object reference each time even when
  // the underlying generated code hasn't changed at all. Deriving a
  // content-based string signature and keying the memo/effect below on that
  // (instead of on `files`/`entryFile` object identity) makes them skip
  // recomputation whenever the actual content is unchanged: JS compares
  // strings by value, not reference, so two independently-parsed-but-
  // identical `files` arrays produce the exact same signature string.
  // Without this, the iframe's `srcdoc` was being reassigned (reloading the
  // whole preview, wiping focus/typed state) on almost every parent
  // re-render — confirmed via a load-event counter firing dozens of times
  // per second — which is what made the preview look "rendered but
  // uninteractive": a click or keystroke lands, then the frame reloads out
  // from under it before the next paint.
  const filesSignature = useMemo(
    () => files.map((f) => `${f.name}:${f.content}`).join(' '),
    [files]
  );
  const entryFile = useMemo(() => pickEntryFile(files), [filesSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setError(null);

    if (!entryFile || !iframeRef.current) return;

    const { combinedCode: code, unresolved } = resolveAndInline(entryFile, files);
    if (unresolved.length > 0) {
      setError(`This preview only supports React itself plus the generated component files — could not resolve: ${unresolved.join(', ')}`);
      return;
    }

    setCompiling(true);
    // Loaded lazily so pages that never render a live preview don't pay for
    // Babel's bundle size.
    import('@babel/standalone')
      .then((Babel) => {
        if (cancelled) return;
        let transformed: string;
        try {
          // runtime: 'classic' is required here — the default "automatic"
          // JSX runtime emits `import { jsx as _jsx } from "react/jsx-runtime"`,
          // which this module-less sandboxed iframe (no bundler, no import
          // resolution) cannot load. Classic emits plain
          // `React.createElement(...)` calls against the UMD `React`
          // global loaded below instead.
          transformed = Babel.transform(code, {
            presets: [['react', { runtime: 'classic' }], 'typescript'],
            filename: 'preview.tsx',
          }).code || '';
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to compile the generated component for preview');
          setCompiling(false);
          return;
        }

        const entryMatch = entryFile.content.match(/function\s+(\w+)\s*\(/);
        const entryName = /const __PreviewEntry__/.test(transformed) ? '__PreviewEntry__' : (entryMatch?.[1] || 'App');

        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#fff;color:#111}#root{padding:16px}</style>
<script src="${REACT_CDN}"></script>
<script src="${REACT_DOM_CDN}"></script>
<script src="${AXIOS_CDN}"></script>
<script src="${PROP_TYPES_CDN}"></script>
<script src="${RECHARTS_CDN}"></script>
</head><body>
<div id="root"></div>
<script>
window.onerror = function (message) {
  parent.postMessage({ __livePreviewError: String(message) }, '*');
};
try {
  const { useState, useEffect, useReducer, useMemo, useCallback, useRef, Fragment } = React;
  // Destructured so named imports from 'recharts' (stripped by
  // parseModuleSyntax like every other allowed specifier) resolve as plain
  // identifiers in the transformed code below. ResponsiveContainer is
  // intentionally included even though it doesn't render in this sandbox —
  // omitting it would turn an LLM-generated ResponsiveContainer usage into a
  // ReferenceError instead of a silently-empty chart area.
  const {
    LineChart, BarChart, AreaChart, PieChart, RadarChart,
    Line, Bar, Area, Pie, Cell, Radar,
    XAxis, YAxis, CartesianGrid, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
    Tooltip, Legend, ResponsiveContainer,
  } = Recharts;
  ${FORM_POLYFILL}
  ${transformed}
  const Entry = typeof ${entryName} !== 'undefined' ? ${entryName} : null;
  if (!Entry) throw new Error('No component found to render in the generated entry file');
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(React.createElement(Entry));
} catch (err) {
  parent.postMessage({ __livePreviewError: String((err && err.message) || err) }, '*');
}
</script>
</body></html>`;

        if (iframeRef.current) iframeRef.current.srcdoc = html;
        setCompiling(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load the preview compiler');
        setCompiling(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally
    // keyed on the content-based signature, not `entryFile`'s object
    // identity; see the comment above `filesSignature` for why.
  }, [filesSignature]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data && typeof event.data === 'object' && '__livePreviewError' in event.data) {
        setError(String((event.data as { __livePreviewError: unknown }).__livePreviewError));
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  if (!entryFile) {
    return (
      <div className="rounded-lg border border-dark-border bg-dark-bg p-6 text-center h-[360px] flex items-center justify-center">
        <p className="text-xs text-text-muted">No frontend entry component generated yet.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-dark-border bg-dark-bg p-6 text-center h-[360px] flex flex-col items-center justify-center">
        <AlertTriangle className="h-6 w-6 text-status-warning mb-2" />
        <p className="text-sm text-text-primary font-medium">Build validated — live preview unavailable</p>
        <p className="text-[11px] text-text-muted mt-1 max-w-md break-words">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {compiling && (
        <div className="absolute inset-0 flex items-center justify-center bg-dark-bg/60 rounded-lg z-10">
          <Loader2 className="h-5 w-5 text-ey-yellow animate-spin" />
        </div>
      )}
      <iframe
        ref={iframeRef}
        title="Live Preview"
        sandbox="allow-scripts"
        className="w-full h-[360px] rounded-lg border border-dark-border bg-white"
      />
    </div>
  );
}
