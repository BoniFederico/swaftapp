import { describe, it, expect } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { seeboCompletionSource } from './seebo-cm';

function ctx(doc: string, pos: number, explicit = true): CompletionContext {
  return new CompletionContext(EditorState.create({ doc }), pos, explicit);
}

describe('seeboCompletionSource', () => {
  it('offers Seebo completions inside an unclosed slot', () => {
    const doc = 'Hello ${ tex }';
    const res = seeboCompletionSource(ctx(doc, doc.indexOf('tex') + 3));
    expect(res).not.toBeNull();
    const labels = res!.options.map((o) => o.label);
    expect(labels).toContain('textbox');
    expect(labels).toContain('action');
    expect(labels).toContain('string()');
  });

  it('also activates inside an @{ … } slot', () => {
    const doc = '@{ ABS }';
    expect(seeboCompletionSource(ctx(doc, doc.indexOf('ABS') + 3))).not.toBeNull();
  });

  it('returns null outside any slot', () => {
    expect(seeboCompletionSource(ctx('plain text here', 5))).toBeNull();
  });

  it('returns null once the slot is closed', () => {
    const doc = "${ textbox({ id:'x' }) } after";
    expect(seeboCompletionSource(ctx(doc, doc.length - 2))).toBeNull();
  });
});
