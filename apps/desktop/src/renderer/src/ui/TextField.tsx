import { useId, type InputHTMLAttributes } from 'react';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label?: string;
}

/** Shared text input with label. */
export function TextField({ label, className, ...rest }: TextFieldProps) {
  const id = useId();
  return (
    <div className="ui-field">
      {label && (
        <label className="ui-field__label" htmlFor={id}>
          {label}
        </label>
      )}
      <input id={id} className={`ui-input ${className ?? ''}`.trim()} {...rest} />
    </div>
  );
}
