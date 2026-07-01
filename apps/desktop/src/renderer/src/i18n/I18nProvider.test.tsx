import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider, useI18n } from './I18nProvider';
import type { TranslationKey } from './catalogs';

function Consumer() {
  const { t, language, setLanguage } = useI18n();
  return (
    <div>
      <span data-testid="lang">{language}</span>
      <span data-testid="theme-label">{t('settings.theme')}</span>
      <span data-testid="greeting">{t('gallery.greeting', { name: 'Ada' })}</span>
      <span data-testid="missing">{t('not.a.real.key' as TranslationKey)}</span>
      <button onClick={() => setLanguage('it')}>it</button>
      <button onClick={() => setLanguage('en')}>en</button>
    </div>
  );
}

describe('I18nProvider', () => {
  beforeEach(() => localStorage.clear());

  it('translates in English by default and switches to Italian', () => {
    render(
      <I18nProvider>
        <Consumer />
      </I18nProvider>,
    );
    expect(screen.getByTestId('theme-label').textContent).toBe('Theme');
    fireEvent.click(screen.getByText('it'));
    expect(screen.getByTestId('lang').textContent).toBe('it');
    expect(screen.getByTestId('theme-label').textContent).toBe('Tema');
  });

  it('interpolates variables', () => {
    render(
      <I18nProvider>
        <Consumer />
      </I18nProvider>,
    );
    expect(screen.getByTestId('greeting').textContent).toBe('Hello, Ada!');
    fireEvent.click(screen.getByText('it'));
    expect(screen.getByTestId('greeting').textContent).toBe('Ciao, Ada!');
  });

  it('falls back to the key when a translation is missing', () => {
    render(
      <I18nProvider>
        <Consumer />
      </I18nProvider>,
    );
    expect(screen.getByTestId('missing').textContent).toBe('not.a.real.key');
  });
});
