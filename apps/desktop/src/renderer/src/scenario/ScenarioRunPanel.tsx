import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ScenarioRunStepDto } from '@swaft/shared';
import { useI18n } from '../i18n/I18nProvider';
import { Button, ChevronIcon, CloseIcon, IconButton, useFocusTrap } from '../ui';
import { InputPanel } from '../document/InputPanel';
import type { ScenarioRunController } from './useScenarioRun';

function shortTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
}

/**
 * The run panel below the canvas: the followed run's status + its per-node steps (click for detail),
 * an inline input prompt when an attended run pauses for a block's missing inputs, and the scenario's
 * run history. Purely presentational — the run lifecycle lives in {@link ScenarioRunController}.
 */
export function ScenarioRunPanel({
  controller,
  minimized,
  onToggleMinimize,
  onRunBatch,
  height,
  historyWidth,
  onResize,
  onHistoryResize,
}: {
  controller: ScenarioRunController;
  minimized: boolean;
  onToggleMinimize: () => void;
  /** Launch a batch of `count` runs spaced by `interRunDelayMs` (goes through action-authorization). */
  onRunBatch: (count: number, interRunDelayMs: number) => void;
  height: number;
  historyWidth: number;
  /** Pointer-down on the top divider (vertical resize of the whole panel). */
  onResize: (e: React.PointerEvent) => void;
  /** Pointer-down on the divider between the step list and the history (horizontal resize). */
  onHistoryResize: (e: React.PointerEvent) => void;
}) {
  const { t } = useI18n();
  const { status, runs, batch, batchActive } = controller;
  const [detail, setDetail] = useState<ScenarioRunStepDto | null>(null);
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const [count, setCount] = useState(10);
  const [intervalSec, setIntervalSec] = useState(1);

  // Reset the pending-input form each time a new pause begins.
  const pendingNode = status?.pending?.nodeId ?? null;
  useEffect(() => setInputs({}), [pendingNode]);

  return (
    <div className="scenario-run" style={minimized ? undefined : { height }}>
      {!minimized && (
        <div
          className="scenario-run__vsplit"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('scenario.resizeRun')}
          onPointerDown={onResize}
        />
      )}
      <div className="scenario-run__bar">
        <span className="scenario-run__bar-title">{t('scenario.runs')}</span>
        {batch && (batchActive || batch.status !== 'completed') && (
          <span className="ui-badge scenario-run__batch-badge">
            {t('scenario.batchProgress', { done: batch.completed, total: batch.total })}
          </span>
        )}
        {status && (
          <span className={`ui-badge scenario-run__status--${status.run.status}`}>{status.run.status}</span>
        )}
        <span className="scenario-run__spacer" />
        <IconButton
          label={minimized ? t('scenario.maximize') : t('scenario.minimize')}
          onClick={onToggleMinimize}
        >
          <ChevronIcon style={{ transform: minimized ? 'rotate(180deg)' : undefined }} />
        </IconButton>
      </div>
      {!minimized && (
      <div className="scenario-run__cols">
        <div className="scenario-run__main">
          <div className="scenario-run__batch">
            {batchActive && batch ? (
              <>
                <span className="scenario-run__batch-label">
                  {t('scenario.batchRunning', { done: batch.completed, total: batch.total })}
                </span>
                <span className="scenario-run__spacer" />
                <Button variant="danger" onClick={() => void controller.stopBatch()}>
                  {t('scenario.stopBatch')}
                </Button>
              </>
            ) : (
              <>
                <span className="scenario-run__batch-label">{t('scenario.batchRepeat')}</span>
                <input
                  className="ui-input scenario-run__num"
                  type="number"
                  min={1}
                  max={1000}
                  value={count}
                  aria-label={t('scenario.batchCount')}
                  onChange={(e) => setCount(Math.max(1, Math.min(1000, Math.round(Number(e.target.value) || 1))))}
                />
                <span className="scenario-run__batch-label">{t('scenario.batchEvery')}</span>
                <input
                  className="ui-input scenario-run__num"
                  type="number"
                  min={0}
                  step={0.5}
                  value={intervalSec}
                  aria-label={t('scenario.batchInterval')}
                  onChange={(e) => setIntervalSec(Math.max(0, Number(e.target.value) || 0))}
                />
                <span className="scenario-run__batch-label">{t('scenario.batchSeconds')}</span>
                <span className="scenario-run__spacer" />
                <Button variant="secondary" onClick={() => onRunBatch(count, Math.round(intervalSec * 1000))}>
                  {t('scenario.runBatch')}
                </Button>
              </>
            )}
          </div>
          {status ? (
            <>
              <div className="scenario-run__head">
                <span className={`ui-badge scenario-run__status--${status.run.status}`}>
                  {status.run.status}
                </span>
                <span className="muted">{t('scenario.stepCount', { n: status.steps.length })}</span>
                {status.run.error && <span className="scenario-run__err">{status.run.error}</span>}
              </div>

              {status.pending && (
                <div className="scenario-run__pending">
                  <span className="ui-field__label">{t('scenario.needsInput')}</span>
                  <InputPanel
                    requirements={status.pending.requirements}
                    values={inputs}
                    onChange={(id, v) => setInputs((s) => ({ ...s, [id]: v }))}
                  />
                  <Button variant="primary" onClick={() => void controller.provideInput(inputs)}>
                    {t('scenario.continue')}
                  </Button>
                </div>
              )}

              <ul className="scenario-run__steps">
                {status.steps.map((step) => (
                  <li key={step.id}>
                    <button
                      type="button"
                      className="scenario-run__step"
                      onClick={() => setDetail(step)}
                    >
                      <span className={`ui-badge scenario-step--${step.status}`}>{step.status}</span>
                      <span className="scenario-run__step-kind">{step.kind}</span>
                      {step.alias && <span className="action-item__id">{step.alias}</span>}
                      {step.httpStatus != null && <span className="muted">{step.httpStatus}</span>}
                      <span className="scenario-run__spacer" />
                      {step.durationMs != null && <span className="muted">{step.durationMs} ms</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <span className="muted">{t('scenario.noRun')}</span>
          )}
        </div>

        <div
          className="scenario-run__hsplit"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('scenario.resizeRunHistory')}
          onPointerDown={onHistoryResize}
        />
        <div className="scenario-run__history" style={{ width: historyWidth }}>
          <div className="scenario-run__history-head">
            <span className="ui-field__label">{t('scenario.history')}</span>
            {runs.length > 0 && (
              <Button variant="ghost" onClick={() => void controller.clearRuns()}>
                {t('scenario.clearRuns')}
              </Button>
            )}
          </div>
          {runs.length === 0 ? (
            <span className="muted">{t('scenario.noRuns')}</span>
          ) : (
            <ul className="scenario-run__runs">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className={`scenario-run__run${status?.run.id === r.id ? ' is-active' : ''}`}
                    onClick={() => controller.view(r.id)}
                  >
                    <span className={`ui-badge scenario-run__status--${r.status}`}>{r.status}</span>
                    <span className="muted">{r.mode}</span>
                    <span className="scenario-run__spacer" />
                    <span className="muted">{shortTime(r.startedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      )}

      {detail && <StepDetail step={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

/** A modal with one step's detail: status, HTTP metadata, message and the (truncated) output snapshot. */
function StepDetail({ step, onClose }: { step: ScenarioRunStepDto; onClose: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return createPortal(
    <div ref={ref} className="editor-overlay" role="dialog" aria-modal="true" aria-label={t('scenario.stepDetail')} tabIndex={-1}>
      <div className="editor-modal action-detail">
        <header className="editor-modal__bar">
          <span className="output-modal__title">{t('scenario.stepDetail')}</span>
          <IconButton label={t('name.cancel')} onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </header>
        <div className="action-detail__body">
          <ul className="kv-readonly">
            <Row k={t('scenario.kind.template')} v={step.kind} mono />
            {step.alias && <Row k={t('scenario.alias')} v={step.alias} mono />}
            <Row k={t('api.status')} v={<span className={`ui-badge scenario-step--${step.status}`}>{step.status}</span>} />
            {step.method && <Row k={t('api.method')} v={`${step.method} ${step.url ?? ''}`} mono />}
            {step.httpStatus != null && <Row k="HTTP" v={String(step.httpStatus)} />}
            {step.message && <Row k={t('scenario.message')} v={step.message} />}
            <Row k={t('api.time')} v={shortTime(step.createdAt)} />
          </ul>
          {step.output != null && step.output !== '' && (
            <div className="ui-field">
              <span className="ui-field__label">{t('action.output')}</span>
              <pre className="action-receipt__pre">{String(step.output)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <li className="kv-readonly__row">
      <span className="kv-readonly__key">{k}</span>
      <span className={mono ? 'action-item__id' : undefined}>{v}</span>
    </li>
  );
}
