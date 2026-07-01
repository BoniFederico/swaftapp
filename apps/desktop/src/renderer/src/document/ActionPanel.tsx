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
          {receipts.map((r) => (
            <li key={r.id} className="action-receipt">
              <span className="ui-badge">{r.status}</span>
              <span className="action-item__id">{r.actionType}</span>
              <span className="muted">{r.message}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
