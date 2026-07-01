import { Suspense, lazy } from 'react';
import { RenderPreview } from './RenderPreview';

// Heavy render engines are lazy-loaded only when a template of that subtype is shown.
const MermaidView = lazy(() => import('./engines/MermaidView'));
const EChartsView = lazy(() => import('./engines/EChartsView'));
const SwaggerView = lazy(() => import('./engines/SwaggerView'));

/**
 * Renders a Seebo output by subtype: html/markdown/text via {@link RenderPreview}; mermaid, echarts
 * and swagger via their (lazy-loaded) engines. The single dispatch point for "renderable" output.
 */
export function RenderOutput({ subtype, output }: { subtype: string | null; output: string }) {
  const fallback = <div className="muted render-engine">…</div>;
  switch (subtype) {
    case 'mermaid':
      return (
        <Suspense fallback={fallback}>
          <MermaidView source={output} />
        </Suspense>
      );
    case 'echarts':
      return (
        <Suspense fallback={fallback}>
          <EChartsView source={output} />
        </Suspense>
      );
    case 'swagger':
      return (
        <Suspense fallback={fallback}>
          <SwaggerView source={output} />
        </Suspense>
      );
    default:
      return <RenderPreview subtype={subtype} output={output} />;
  }
}
