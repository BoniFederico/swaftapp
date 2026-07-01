interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

/** Shared toggle switch (accessible: role=switch, keyboard activatable). */
export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="ui-switch"
      onClick={() => onChange(!checked)}
    >
      <span className="ui-switch__track" data-on={checked}>
        <span className="ui-switch__thumb" />
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}
