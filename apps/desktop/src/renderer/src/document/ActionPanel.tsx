import { useEffect, useState } from 'react';
import type { ActionSummaryDto, ReceiptDto } from '@swaft/shared';
import type { ApiClient } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Card } from '../ui';

/**
 * Action Panel (M10): lists the actions a render *prepared* and lets the user confirm + perform them.
 * Execution is server-side via `seebo/actions` (the renderer only sends ids); receipts come back
 * redacted. Shown only when a render produced ≥1 action. See SWAFT_UI_SPEC §17.
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
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [receipts, setReceipts] = useState<ReceiptDto[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void client
      .call('receipt.list', { templateId })
      .then((r) => setReceipts(r.receipts))
      .catch(() => undefined);
  }, [client, templateId]);

  function toggle(id: string) {
    setConfirmed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function perform() {
    setBusy(true);
    try {
      const res = await client.call('action.execute', {
        templateId,
        confirmedActions: [...confirmed],
        failFast: true,
        dryRun: false,
      });
      setReceipts(res.receipts);
      // Reveal the detail of what just ran, so it is one glance away rather than one click.
      const withDetail = res.receipts.find(
        (r) => r.output != null || (r.logs?.length ?? 0) > 0 || (r.envWrites?.length ?? 0) > 0,
      );
      setExpanded(withDetail?.id ?? null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t('action.title')}>
      <ul className="action-list">
        {actions.map((a) => (
          <li key={a.id} className="action-item">
            {a.requiresConfirmation ? (
              <input
                type="checkbox"
                checked={confirmed.has(a.id)}
                onChange={() => toggle(a.id)}
                aria-label={t('action.confirm', { id: a.id })}
              />
            ) : (
              <span className="action-item__spacer" />
            )}
            <span className="ui-badge">{a.type}</span>
            <span className="action-item__id">{a.id}</span>
            <span className="muted">{a.environment}</span>
          </li>
        ))}
      </ul>
      <div className="row" style={{ marginTop: 'var(--space-3)' }}>
        <Button onClick={() => void perform()} disabled={busy}>
          {busy ? t('action.performing') : t('action.perform')}
        </Button>
      </div>
      {receipts.length > 0 && (
        <ul className="action-receipts" data-testid="action-receipts">
          {receipts.map((r) => {
            const hasDetail =
              r.output !== undefined || (r.logs?.length ?? 0) > 0 || (r.envWrites?.length ?? 0) > 0;
            const open = expanded === r.id;
            return (
              <li key={r.id} className={`action-receipt${hasDetail ? ' action-receipt--clickable' : ''}`}>
                {/* The receipt line is a button when there is something to reveal: output, logs, writes. */}
                <button
                  type="button"
                  className="action-receipt__row"
                  disabled={!hasDetail}
                  aria-expanded={hasDetail ? open : undefined}
                  onClick={() => setExpanded(open ? null : r.id)}
                >
                  {hasDetail && (
                    <span className={`action-receipt__twisty${open ? ' is-open' : ''}`} aria-hidden="true">
                      ▸
                    </span>
                  )}
                  <span className={`ui-badge action-receipt__status--${r.status}`}>{r.status}</span>
                  <span className="action-item__id">{r.actionType}</span>
                  <span className="muted">{r.message}</span>
                </button>
                {open && hasDetail && (
                  <div className="action-receipt__detail">
                    {r.output !== undefined && r.output !== null && (
                      <div className="ui-field">
                        <span className="ui-field__label">{t('action.output')}</span>
                        <pre className="action-receipt__pre">{formatOutput(r.output)}</pre>
                      </div>
                    )}
                    {(r.logs?.length ?? 0) > 0 && (
                      <div className="ui-field">
                        <span className="ui-field__label">{t('code.logs')}</span>
                        <pre className="action-receipt__pre">{r.logs!.join('\n')}</pre>
                      </div>
                    )}
                    {(r.envWrites?.length ?? 0) > 0 && (
                      <span className="field-hint">{t('action.wrote', { names: r.envWrites!.join(', ') })}</span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** A string output reads best raw; anything else as pretty JSON. */
function formatOutput(output: unknown): string {
  return typeof output === 'string' ? output : JSON.stringify(output, null, 2);
}
