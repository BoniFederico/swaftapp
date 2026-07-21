import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ActionSummaryDto, ReceiptDto } from '@swaft/shared';
import type { ApiClient } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import { Button, CloseIcon, IconButton, useFocusTrap } from '../ui';

function shortTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
}

/**
 * Action Panel (M10): one launch button per action a render *prepared*, each above its own run
 * history. Pressing Run performs that action (confirming it) server-side via `seebo/actions` — the
 * renderer only sends the id; receipts come back redacted. Clicking a run opens a detail popup with
 * whatever that run recorded (output/logs/env writes for the fresh run; status + message for the
 * redacted audit trail). Shown only when a render produced ≥1 action. See SWAFT_UI_SPEC §17.
 */
export function ActionPanel({
  client,
  templateId,
  actions,
}: {
  client: ApiClient;
  templateId: string;
  actions: ActionSummaryDto[];
}) {
  const { t } = useI18n();
  const [receipts, setReceipts] = useState<ReceiptDto[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReceiptDto | null>(null);

  useEffect(() => {
    void client
      .call('receipt.list', { templateId })
      .then((r) => setReceipts(r.receipts))
      .catch(() => undefined);
  }, [client, templateId]);

  async function run(actionId: string) {
    setBusyId(actionId);
    try {
      const res = await client.call('action.execute', {
        templateId,
        confirmedActions: [actionId],
        failFast: true,
        dryRun: false,
      });
      setReceipts(res.receipts);
      // Surface what just ran: open the fresh receipt for this action so its output is one glance away.
      const fresh = res.receipts.find((r) => r.actionId === actionId && hasDetail(r));
      if (fresh) setDetail(fresh);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="ui-card action-card">
      <div className="ui-card__head">
        <h2 className="ui-card__title">{t('action.title')}</h2>
      </div>
      {/* Only this list scrolls; the card header stays put and its bottom edge fills the container. */}
      <div className="action-panel">
        {actions.map((a) => {
          const runs = receipts.filter((r) => r.actionId === a.id);
          return (
            <div key={a.id} className="action-run">
              <div className="action-run__head">
                <span className="ui-badge">{a.type}</span>
                <span className="action-item__id">{a.id}</span>
                <span className="muted">{a.environment}</span>
                <span className="action-run__spacer" />
                <Button
                  variant="secondary"
                  className="action-run__btn"
                  disabled={busyId !== null}
                  onClick={() => void run(a.id)}
                >
                  {busyId === a.id ? t('action.performing') : t('action.run')}
                </Button>
              </div>
              {runs.length > 0 ? (
                <ul className="action-run__history">
                  {runs.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className="action-run__item"
                        onClick={() => setDetail(r)}
                      >
                        <span className={`ui-badge action-receipt__status--${r.status}`}>
                          {r.status}
                        </span>
                        <span className="muted action-run__msg">{r.message}</span>
                        <span className="action-run__spacer" />
                        <span className="muted action-run__time">{shortTime(r.createdAt)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="field-hint">{t('action.noRuns')}</span>
              )}
            </div>
          );
        })}
      </div>
      {detail && <ReceiptDetail receipt={detail} onClose={() => setDetail(null)} />}
    </section>
  );
}

/** Whether a receipt carries anything worth showing beyond its status line. */
function hasDetail(r: ReceiptDto): boolean {
  return (r.output !== undefined && r.output !== null) || (r.logs?.length ?? 0) > 0 || (r.envWrites?.length ?? 0) > 0;
}

/** A modal with a single run's detail: status, output, logs and the env vars it wrote. */
function ReceiptDetail({ receipt, onClose }: { receipt: ReceiptDto; onClose: () => void }) {
  const { t } = useI18n();
  const overlayRef = useRef<HTMLDivElement>(null);
  useFocusTrap(overlayRef);
  const showsDetail = hasDetail(receipt);
  return createPortal(
    <div
      ref={overlayRef}
      className="editor-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('action.runDetail')}
      tabIndex={-1}
    >
      <div className="editor-modal action-detail">
        <header className="editor-modal__bar">
          <span className="output-modal__title">{t('action.runDetail')}</span>
          <IconButton label={t('name.cancel')} onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </header>
        <div className="action-detail__body">
          <ul className="kv-readonly">
            <li className="kv-readonly__row">
              <span className="kv-readonly__key">{t('action.type')}</span>
              <span className="action-item__id">{receipt.actionType}</span>
            </li>
            <li className="kv-readonly__row">
              <span className="kv-readonly__key">{t('api.status')}</span>
              <span className={`ui-badge action-receipt__status--${receipt.status}`}>
                {receipt.status}
              </span>
            </li>
            <li className="kv-readonly__row">
              <span className="kv-readonly__key">{t('action.message')}</span>
              <span className="muted">{receipt.message}</span>
            </li>
            <li className="kv-readonly__row">
              <span className="kv-readonly__key">{t('api.time')}</span>
              <span className="muted">{shortTime(receipt.createdAt)}</span>
            </li>
          </ul>
          {receipt.output !== undefined && receipt.output !== null && (
            <div className="ui-field">
              <span className="ui-field__label">{t('action.output')}</span>
              <pre className="action-receipt__pre">{formatOutput(receipt.output)}</pre>
            </div>
          )}
          {(receipt.logs?.length ?? 0) > 0 && (
            <div className="ui-field">
              <span className="ui-field__label">{t('code.logs')}</span>
              <pre className="action-receipt__pre">{receipt.logs!.join('\n')}</pre>
            </div>
          )}
          {(receipt.envWrites?.length ?? 0) > 0 && (
            <span className="field-hint">{t('action.wrote', { names: receipt.envWrites!.join(', ') })}</span>
          )}
          {!showsDetail && <p className="muted action-detail__note">{t('action.redacted')}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A string output reads best raw; anything else as pretty JSON. */
function formatOutput(output: unknown): string {
  return typeof output === 'string' ? output : JSON.stringify(output, null, 2);
}
