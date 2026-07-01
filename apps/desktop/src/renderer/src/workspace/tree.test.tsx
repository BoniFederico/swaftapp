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

  it('reflects an external tag change in the Tags view in real time', async () => {
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
    fireEvent.click(await screen.findByRole('tab', { name: 'Tags' }));

    // Before tagging, the template sits under "Untagged".
    expect(await screen.findByText('Untagged')).toBeInTheDocument();
    expect(screen.queryByText('urgent')).toBeNull();

    // An external mutation (as the editor would do) + a tree-changed notification reflects live.
    await org.addTemplateTag(docId, 'urgent');
    notifyTreeChanged();

    expect(await screen.findByText('urgent')).toBeInTheDocument();
  });
});
