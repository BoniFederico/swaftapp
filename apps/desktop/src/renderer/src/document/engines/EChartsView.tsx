import { useEffect, useRef, useState } from 'react';
import type { EChartsType } from 'echarts';
import { useTheme } from '../../theme/ThemeProvider';
import { parseSpec } from './parseSpec';

/** Renders an ECharts chart from a Seebo output that is an ECharts `option` (JSON or YAML; lazy-loaded). */
export default function EChartsView({ source }: { source: string }) {
  const { resolved } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let chart: EChartsType | null = null;
    const onResize = () => chart?.resize();
    void (async () => {
      let option: unknown;
      try {
        option = await parseSpec(source);
      } catch {
        if (!cancelled) setError('Invalid ECharts option (expected JSON or YAML).');
        return;
      }
      if (!option || typeof option !== 'object') {
        if (!cancelled) setError('');
        return;
      }
      const echarts = await import('echarts');
      if (cancelled || !host.current) return;
      chart = echarts.init(host.current, resolved === 'dark' ? 'dark' : undefined);
      chart.setOption(option as Parameters<EChartsType['setOption']>[0]);
      setError('');
      window.addEventListener('resize', onResize);
    })();
    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      chart?.dispose();
    };
  }, [source, resolved]);

  if (error) {
    return (
      <div className="render-engine auth-error" role="alert">
        {error}
      </div>
    );
  }
  return <div ref={host} className="render-engine render-engine--chart" />;
}
