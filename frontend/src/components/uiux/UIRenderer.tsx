import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <div className="text-red-500 p-4 border border-red-500 rounded bg-black/50 text-sm overflow-auto">
          <strong>Component Render Error:</strong> {this.state.error?.message}
        </div>
      );
    }
    return this.props.children;
  }
}

const UIRendererNode = ({ node }: { node: any }) => {
  if (!node) return null;
  
  if (!node.type || node.type === 'text') {
    return <>{node.label || ''}</>;
  }
  
  // Ensure ComponentType is a valid lowercase string (HTML tag)
  let rawType = typeof node.type === 'string' ? node.type.toLowerCase() : 'div';
  
  const validTags = new Set([
    'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'button', 
    'ul', 'ol', 'li', 'section', 'nav', 'header', 'footer', 'main', 'aside', 
    'table', 'tr', 'td', 'th', 'thead', 'tbody', 'img', 'input', 'textarea', 
    'select', 'option', 'form', 'label', 'svg', 'path', 'strong', 'em', 'i', 'b'
  ]);

  const ComponentType = validTags.has(rawType) ? rawType : 'div';
  
  // Safely extract props and children
  const props = typeof node.props === 'object' && node.props !== null ? node.props : {};
  const children = Array.isArray(node.children) ? node.children : [];
  const label = node.label;
  
  // Ensure style is an object to prevent React from crashing on string styles
  let safeStyle: any = {};
  if (typeof props.style === 'object' && props.style !== null) {
    // Sanitize style keys for React (convert kebab-case to camelCase and fix vendor prefixes)
    Object.entries(props.style).forEach(([key, value]) => {
      let reactKey = key;
      if (reactKey.startsWith('-webkit-')) {
        reactKey = 'Webkit' + reactKey.slice(8).replace(/-./g, x => x[1].toUpperCase());
      } else if (reactKey.startsWith('-moz-')) {
        reactKey = 'Moz' + reactKey.slice(5).replace(/-./g, x => x[1].toUpperCase());
      } else if (reactKey.startsWith('-ms-')) {
        reactKey = 'ms' + reactKey.slice(4).replace(/-./g, x => x[1].toUpperCase());
      } else if (reactKey.includes('-')) {
        reactKey = reactKey.replace(/-./g, x => x[1].toUpperCase());
      }
      safeStyle[reactKey] = value;
    });
  }
  safeStyle.fontFamily = safeStyle.fontFamily || 'var(--font-family)';

  // Omit children from props if it exists to avoid React conflicts
  const { children: _childrenProp, ...restProps } = props;

  // Intercept links so they don't route away from our preview app
  if (ComponentType === 'a' || ComponentType === 'form') {
      restProps.onClick = (e: any) => e.preventDefault();
      restProps.onSubmit = (e: any) => e.preventDefault();
  }

  const safeProps = {
    ...restProps,
    style: safeStyle
  };

  const voidElements = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];

  if (voidElements.includes(ComponentType)) {
    return React.createElement(ComponentType, safeProps);
  }

  // React throws FATAL errors if <textarea> has children. Use defaultValue instead.
  if (ComponentType === 'textarea') {
    const textContent = label || (children.length > 0 && children[0].label ? children[0].label : '');
    safeProps.defaultValue = textContent;
    return React.createElement('textarea', safeProps);
  }

  // Only render the label if it's a typical text element, or if the node has no children.
  // This prevents the AI's descriptive labels (like "Main Container") from breaking flexbox/grid layouts.
  const textElements = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a', 'button', 'label', 'li', 'td', 'th', 'strong', 'em', 'b', 'i', 'small', 'code', 'option'];
  const shouldRenderLabel = label && (textElements.includes(ComponentType) || children.length === 0);

  return (
    <ComponentType {...safeProps}>
      {shouldRenderLabel && <>{label}</>}
      {children.map((child: any, index: number) => (
        <UIRendererNode key={child.id || index} node={child} />
      ))}
    </ComponentType>
  );
};

const UIRenderer = ({ node }: { node: any }) => {
  return (
    <ErrorBoundary>
      <UIRendererNode node={node} />
    </ErrorBoundary>
  );
};

export default UIRenderer;
