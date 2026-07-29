import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ResultEnvelope } from '@swaft/shared';
import { AppProviders } from '../AppProviders';
import { ApiClient } from '../api-client/client';
import type { Transport } from '../api-client/transport/types';
import { dispatch } from '../../../main/transport/dispatch';
import { setSessionGate } from '../../../main/transport/session';
import { getOrganizationService, getTemplateService } from '../../../main/services';
import {
  installTestWorkspaceBackend,
  resetTestWorkspaceBackend,
} from '../../../main/workspace/testing';
import { WorkingTree } from './WorkingTree';
import { notifyTreeChanged } from './treeBus';

class DispatchTransport implements Transport {
  call(op: string, payload?: unknown): Promise<ResultEnvelope<unknown>> {
    return dispatch(op, payload);
  }
}
const client = new ApiClient(new DispatchTransport());

describe('Working Tree — nesting & drag-and-drop', () => {
  beforeEach(() => setSessionGate({ isSignedIn: () => true }));
  afterEach(() => {
    setSessionGate({ isSignedIn: () => false });
    resetTestWorkspaceBackend();
  });

  it('moves a template into another folder by dragging it', async () => {
    const { workspace } = installTestWorkspaceBackend();
    await workspace.create({ name: 'WS', location: 'mem://t.swaft', encrypt: false });
    const org = getOrganizationService();
    let tree = await org.createProject({ name: 'P' });
    const projectId = tree.projects[0]!.id;
    tree = await org.createFolder({ name: 'Aaa', projectId });
    tree = await org.createFolder({ name: 'Bbb', projectId });
    const bbb = tree.folders.find((f) => f.name === 'Bbb')!.id;
    const a = tree.folders.find((f) => f.name === 'Aaa')!.id;
    await getTemplateService().createTemplate({ folderId: a, name: 'Doc', type: 'document' });

    render(
      <AppProviders>
        <WorkingTree
          client={client}
          openTemplateId={null}
          onOpenTemplate={() => {}}
          onCollapse={() => {}}
        />
      </AppProviders>,
    );

    // Select the project so its folders show.
    fireEvent.click(await screen.findByRole('button', { name: 'Select project' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'P' }));

    // Clicking a folder row expands it — reveal Doc inside Aaa.
    fireEvent.click((await screen.findByText('Aaa')).closest('.tree-item')!);
    const doc = (await screen.findByText('Doc')).closest('.tree-item')!;
    const bRow = screen.getByText('Bbb').closest('.tree-item')!;

    fireEvent.dragStart(doc);
    fireEvent.drop(bRow);

    await waitFor(async () => {
      const tr = await org.getTree();
      expect(tr.templates.find((t) => t.name === 'Doc')?.folderId).toBe(bbb);
    });
  });

  it('search narrows the tree to name/content matches; the funnel filters by type', async () => {
    const { workspace } = installTestWorkspaceBackend();
    await workspace.create({ name: 'WS', location: 'mem://sr.swaft', encrypt: false });
    const org = getOrganizationService();
    let tree = await org.createProject({ name: 'P' });
    tree = await org.createFolder({ name: 'F', projectId: tree.projects[0]!.id });
    const folderId = tree.folders[0]!.id;
    await getTemplateService().createTemplate({
      folderId,
      name: 'Invoice',
      type: 'document',
      source: 'Total amount due: 42',
    });
    await getTemplateService().createTemplate({ folderId, name: 'Call', type: 'api' });

    render(
      <AppProviders>
        <WorkingTree
          client={client}
          openTemplateId={null}
          onOpenTemplate={() => {}}
          onCollapse={() => {}}
        />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Select project' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'P' }));

    // The folder starts collapsed: no template rows yet.
    await screen.findByText('F');
    expect(screen.queryByText('Invoice')).toBeNull();

    // A content search reveals the matching template, auto-expanding its folder.
    const search = screen.getByLabelText('Search templates');
    fireEvent.change(search, { target: { value: 'amount due' } });
    expect(await screen.findByText('Invoice')).toBeInTheDocument();
    expect(screen.queryByText('Call')).toBeNull();

    // No matches → the empty hint (and no folder rows).
    fireEvent.change(search, { target: { value: 'no-such-needle' } });
    expect(await screen.findByText('No matching templates.')).toBeInTheDocument();
    expect(screen.queryByText('F')).toBeNull();

    // Clearing the search collapses the tree back.
    fireEvent.change(search, { target: { value: '' } });
    expect(await screen.findByText('F')).toBeInTheDocument();
    expect(screen.queryByText('Invoice')).toBeNull();

    // The funnel narrows by type: only the API template survives.
    fireEvent.click(screen.getByRole('button', { name: 'Filter by type' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'API' }));
    expect(await screen.findByText('Call')).toBeInTheDocument();
    expect(screen.queryByText('Invoice')).toBeNull();
  });

  it('reflects an external tag change in the tag badges in real time', async () => {
    const { workspace } = installTestWorkspaceBackend();
    await workspace.create({ name: 'WS', location: 'mem://tg.swaft', encrypt: false });
    const org = getOrganizationService();
    let tree = await org.createProject({ name: 'P' });
    tree = await org.createFolder({ name: 'F', projectId: tree.projects[0]!.id });
    const folderId = tree.folders[0]!.id;
    const made = await getTemplateService().createTemplate({ folderId, name: 'Doc', type: 'document' });
    const docId = made.templates.find((t) => t.name === 'Doc')!.id;

    render(
      <AppProviders>
        <WorkingTree
          client={client}
          openTemplateId={null}
          onOpenTemplate={() => {}}
          onCollapse={() => {}}
        />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Select project' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'P' }));
    // Switch the row badges to tag dots and reveal the template.
    fireEvent.click(screen.getByRole('button', { name: /Showing subtype badges/ }));
    fireEvent.click((await screen.findByText('F')).closest('.tree-item')!);
    await screen.findByText('Doc');
    expect(document.querySelector('.tree-tagdot')).toBeNull();

    // An external mutation (as the editor would do) + a tree-changed notification reflects live.
    await org.addTemplateTag(docId, 'urgent');
    notifyTreeChanged();

    await waitFor(() => expect(document.querySelector('.tree-tagdot')).not.toBeNull());
    expect(document.querySelector('.tree-tagdot')).toHaveAttribute('title', 'urgent');
  });

  it('replaces a scenario\'s graph in place via "Import Arazzo…"', async () => {
    const { workspace } = installTestWorkspaceBackend();
    await workspace.create({ name: 'WS', location: 'mem://arazzo.swaft', encrypt: false });
    const org = getOrganizationService();
    let tree = await org.createProject({ name: 'P' });
    tree = await org.createFolder({ name: 'F', projectId: tree.projects[0]!.id });
    const folderId = tree.folders[0]!.id;
    const made = await getTemplateService().createTemplate({
      folderId,
      name: 'Flow',
      type: 'scenario',
    });
    const scenarioId = made.templates.find((t) => t.name === 'Flow')!.id;

    render(
      <AppProviders>
        <WorkingTree
          client={client}
          openTemplateId={null}
          onOpenTemplate={() => {}}
          onCollapse={() => {}}
        />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Select project' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'P' }));
    fireEvent.click((await screen.findByText('F')).closest('.tree-item')!);
    const flowRow = (await screen.findByText('Flow')).closest('.tree-item')!;
    fireEvent.click(flowRow.querySelector('.tree-item__menu button')!);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Import Arazzo…' }));

    const doc = {
      arazzo: '1.0.0',
      info: { title: 'Flow', version: '1.0.0' },
      workflows: [
        {
          workflowId: 'flow',
          steps: [{ stepId: 'n1', 'x-swaft': { kind: 'delay', position: { x: 0, y: 0 } }, ms: 500 }],
          'x-swaft-start': { id: 'start', position: { x: 0, y: 0 }, next: 'n1' },
        },
      ],
    };
    fireEvent.change(await screen.findByPlaceholderText(/Paste an Arazzo/), {
      target: { value: JSON.stringify(doc) },
    });
    await screen.findByText(/2 nodes · 1 edges/);
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(async () => {
      const full = await getTemplateService().getTemplate(scenarioId);
      expect(JSON.parse(full!.source).nodes).toHaveLength(2);
    });
  });
});
