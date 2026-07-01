import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  'aria-label'?: string;
}

/**
 * Shared single-select dropdown — a custom, fully-stylable listbox (not a native <select>), so the
 * open options support hover/cursor/focus styling. Accessible: button with aria-haspopup=listbox +
 * aria-expanded; role=listbox/option; keyboard nav (Arrow/Home/End/Enter/Esc); outside-click closes.
 */
export function Select({ label, value, options, onChange, 'aria-label': ariaLabel }: SelectProps) {
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selectedLabel = options[selectedIndex]?.label ?? '';

  useEffect(() => {
    if (!open) return;
    setActive(selectedIndex);
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, selectedIndex]);

  function choose(i: number) {
    const opt = options[i];
    if (opt) onChange(opt.value);
    setOpen(false);
    btnRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((a) => Math.min(options.length - 1, a + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(active);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  return (
    <div className="ui-field">
      {label && (
        <span className="ui-field__label" id={labelId}>
          {label}
        </span>
      )}
      <div className="ui-select-wrap" ref={wrapRef}>
        <button
          ref={btnRef}
          type="button"
          className="ui-select"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={label ? labelId : undefined}
          aria-label={ariaLabel}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={onKeyDown}
        >
          <span>{selectedLabel}</span>
          <span className="ui-select__chevron" aria-hidden="true">
            ▾
          </span>
        </button>
        {open && (
          <ul className="ui-listbox" role="listbox" aria-labelledby={label ? labelId : undefined}>
            {options.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                data-active={i === active}
                className="ui-option"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
              >
                {o.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
