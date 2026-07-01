import { useEffect, useState } from 'react';
import { useTheme } from '../../theme/ThemeProvider';

let counter = 0;

/** Renders a Mermaid diagram from the Seebo output (lazy-loaded; themed). */
export default function MermaidView({ source }: { source: string }) {
  const { resolved } = useTheme();
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const id = `mmd-${counter++}`;
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: resolved === 'dark' ? 'dark' : 'default',
          securityLevel: 'strict',
          // Don't inject mermaid's own "Syntax error" diagram into the page on invalid input.
          suppressErrorRendering: true,
        });
        const { svg } = await mermaid.render(id, source.trim());
        if (!cancelled) {
          setSvg(svg);
          setError('');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        // Mermaid measures in a temporary off-DOM node `d<id>`; remove any leftover (esp. on error).
        document.getElementById(`d${id}`)?.remove();
      }
    })();
    return () => {
      cancelled = true;
      document.getElementById(`d${id}`)?.remove();
    };
  }, [source, resolved]);

  if (error) {
    return (
      <div className="render-engine auth-error" role="alert">
        {error}
      </div>
    );
  }
  return <div className="render-engine render-engine--center" dangerouslySetInnerHTML={{ __html: svg }} />;
}
