import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

/** Shared Button. The only button primitive in the app (UI-SPEC §23.6 UCOH-1). */
export function Button({ variant = 'primary', className, ...rest }: ButtonProps) {
  return <button className={`ui-btn ui-btn--${variant} ${className ?? ''}`.trim()} {...rest} />;
}
