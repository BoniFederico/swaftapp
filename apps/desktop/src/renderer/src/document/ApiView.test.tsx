import { describe, it, expect } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { makeError, ok, type RequirementDto, type ResultEnvelope } from '@swaft/shared';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
import { ApiView } from './ApiView';

/** Type into a CodeMirror-backed field (the URL/value editors) — `fireEvent.change` doesn't apply. */
function typeInto(container: HTMLElement, ariaLabel: string, text: string) {
  const content = container.querySelector(`[aria-label="${ariaLabel}"]`);
  const view = EditorView.findFromDOM(content?.closest('.cm-editor') as HTMLElement);
  act(() => view!.dispatch({ changes: { from: 0, to: view!.state.doc.length, insert: text } }));
}

const SEG: RequirementDto = {
  id: 'seg',
  capability: 'textbox',
  label: null,
  options: null,
  type: { kind: 'string', precision: null, pattern: null, min: null, max: null, maxLength: null },
};

function template(source = JSON.stringify({ method: 'GET', url: '' })) {
  return {
    id: 't1',
    folderId: null,
    projectId: 'p1',
    name: 'Call',
    type: 'api' as const,
    subtype: 'json',
    tagIds: [] as string[],
    method: 'GET',
    source,
    hasDraft: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

/** A fake transport: canned op responses; `http.send` records calls and enforces the input gate. */
function makeTransport(sent: unknown[]): Transport {
  return {
    call(op, payload): Promise<ResultEnvelope<unknown>> {
      const p = (payload ?? {}) as { request?: { url?: string }; values?: Record<string, unknown> };
      switch (op) {
        case 'template.get':
          return Promise.resolve(ok({ template: template() }));
        case 'api.history.list':
          return Promise.resolve(ok({ items: [] }));
        case 'secret.list':
          return Promise.resolve(ok({ refs: [] }));
        case 'inputState.get':
          return Promise.resolve(ok({ values: {} }));
        case 'inputState.set':
          return Promise.resolve(ok({ values: p.values ?? {} }));
        case 'template.updateSource':
          return Promise.resolve(ok({ template: template() }));
        case 'api.analyze': {
          const url = p.request?.url ?? '';
          return Promise.resolve(ok({ requirements: url.includes('${') ? [SEG] : [], diagnostics: [] }));
        }
        case 'http.send': {
          sent.push(p);
          const url = p.request?.url ?? '';
          const rendered = url.includes('${');
          // Mimic the backend: a formula with no matching input value is rejected.
          if (rendered && !p.values?.seg) {
            return Promise.resolve(makeError('INPUT_REQUIRED', 'validation', 'Fill the required inputs.'));
          }
          const resolvedUrl = rendered
            ? url.replace(/\$\{[^}]*\}/g, String(p.values?.seg ?? ''))
            : url;
          return Promise.resolve(
            ok({
              response: {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                body: '{"ok":true}',
                durationMs: 5,
              },
              rendered,
              request: rendered ? { ...(p.request ?? {}), url: resolvedUrl } : undefined,
            }),
          );
        }
        default:
          return Promise.resolve(ok({}));
      }
    },
  };
}

function renderApiView(sent: unknown[]) {
  return render(
    <AppProviders>
      <ApiView client={new ApiClient(makeTransport(sent))} templateId="t1" />
    </AppProviders>,
  );
}

describe('ApiView — formula inputs (Fase 1)', () => {
  it('surfaces a URL formula input in the Input tab, gates send, then sends the values', async () => {
    const sent: unknown[] = [];
    const { container } = renderApiView(sent);
    await screen.findByRole('button', { name: 'Send' });

    typeInto(container, 'URL', "https://example.com/${ textbox({ id:'seg', type:string() }) }");

    // Sending with the input unfilled is rejected and surfaces the Input tab + its widget.
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const seg = await screen.findByLabelText('seg');
    expect((sent[0] as { values?: Record<string, unknown> }).values?.seg).toBeUndefined();

    fireEvent.change(seg, { target: { value: 'users' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(screen.getByTestId('api-response-body').textContent).toContain('ok'),
    );
    const last = sent[sent.length - 1] as { values?: Record<string, unknown> };
    expect(last.values).toEqual({ seg: 'users' });
  });

  it('shows no inputs for a plain (formula-free) request', async () => {
    const sent: unknown[] = [];
    const { container } = renderApiView(sent);
    await screen.findByRole('button', { name: 'Send' });
    typeInto(container, 'URL', 'https://example.com/x');

    fireEvent.click(screen.getByRole('tab', { name: /Input/ }));
    expect(await screen.findByText(/Use \$\{ … \} formulas|Nessun input/i)).toBeInTheDocument();
  });

  it('offers a "Request render" tab showing the rendered request after a formula send', async () => {
    const sent: unknown[] = [];
    const { container } = renderApiView(sent);
    await screen.findByRole('button', { name: 'Send' });
    typeInto(container, 'URL', "https://example.com/${ textbox({ id:'seg', type:string() }) }");

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const seg = await screen.findByLabelText('seg');
    fireEvent.change(seg, { target: { value: 'users' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const tab = await screen.findByRole('tab', { name: /Request render/ });
    fireEvent.click(tab);
    const overview = await screen.findByTestId('api-request-render');
    expect(overview.textContent).toContain('https://example.com/users');
  });
});
