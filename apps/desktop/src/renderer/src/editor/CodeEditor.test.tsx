import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppProviders } from '../AppProviders';
import { CodeEditor } from './CodeEditor';

describe('CodeEditor — Seebo semantic highlight', () => {
  it('tokenizes a formula: function name, property key and string', async () => {
    render(
      <AppProviders>
        <CodeEditor
          value="Hi ${ textbox({ id: 'name' }) }"
          language="html"
          onChange={() => {}}
          ariaLabel="Source"
        />
      </AppProviders>,
    );
    // The widget call is highlighted as a function, the key as a property, the value as a string.
    expect((await screen.findByText('textbox')).className).toContain('cm-sb-fn');
    expect(screen.getByText('id').className).toContain('cm-sb-prop');
    expect(screen.getByText("'name'").className).toContain('cm-sb-str');
  });
});
