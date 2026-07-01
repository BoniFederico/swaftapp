import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../../theme/ThemeProvider';
import { parseSpec } from './parseSpec';

type SwaggerBundle = (opts: { domNode: HTMLElement; spec: unknown }) => void;

/** Renders an OpenAPI/Swagger spec (JSON or YAML) with Swagger UI (lazy-loaded, incl. its stylesheet). */
export default function SwaggerView({ source }: { source: string }) {
  const { resolved } = useTheme();
  const dark = resolved === 'dark';
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let spec: unknown;
      try {
        spec = await parseSpec(source);
      } catch {
        if (!cancelled) setError('Invalid OpenAPI spec (expected JSON or YAML).');
        return;
      }
      if (!spec || typeof spec !== 'object') {
        if (!cancelled) setError('');
        return;
      }
      const mod = (await import('swagger-ui-dist')) as unknown as { SwaggerUIBundle: SwaggerBundle };
      await import('swagger-ui-dist/swagger-ui.css');
      if (cancelled || !host.current) return;
      host.current.innerHTML = '';
      mod.SwaggerUIBundle({ domNode: host.current, spec });
      setError('');
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) {
    return (
      <div className="render-engine auth-error" role="alert">
        {error}
      </div>
    );
  }
  return (
    <div
      ref={host}
      className={`render-engine render-engine--swagger${dark ? ' is-dark' : ''}`}
    />
  );
}
