import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeProvider';

function Consumer() {
  const { resolved, mode, setMode, toggleMode, primaryColor, setPrimaryColor, colors } = useTheme();
  return (
    <div>
      <span data-testid="resolved">{resolved}</span>
      <span data-testid="mode">{mode}</span>
      <button onClick={() => setMode('dark')}>dark</button>
      <button onClick={() => setMode('light')}>light</button>
      <button onClick={toggleMode}>toggle</button>
      <button onClick={() => setPrimaryColor(colors[2])}>teal</button>
      <span data-testid="primary">{primaryColor.key}</span>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('applies the selected theme to the document root', () => {
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText('dark'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');

    fireEvent.click(screen.getByText('light'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applies and persists the primary color', () => {
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText('teal'));
    expect(screen.getByTestId('primary').textContent).toBe('teal');
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#0D9488');
    expect(localStorage.getItem('swaft.theme.primary')).toBe('teal');
  });

  it("resolves 'system' using prefers-color-scheme", () => {
    const mql = {
      matches: true, // system = dark
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia,
    );
    act(() => {
      render(
        <ThemeProvider>
          <Consumer />
        </ThemeProvider>,
      );
    });
    expect(screen.getByTestId('mode').textContent).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    vi.unstubAllGlobals();
  });
});
