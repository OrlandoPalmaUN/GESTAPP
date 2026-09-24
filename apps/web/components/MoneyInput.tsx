'use client';

import React from 'react';
import { formatMoneyInput, parseMoney } from '../lib/format';

/**
 * Input de pesos colombianos.
 *
 * Reemplaza los `<input type="number">` pelados que se usaban para montos:
 * - El peso NO tiene centavos, pero varios traían `step="0.01"`.
 * - Sin separador de miles, escribir `1250000` no se puede verificar de un
 *   vistazo — y un cero de más entra directo a los libros.
 * - `type="number"` responde a la rueda del mouse: pasar el scroll por encima
 *   de un campo enfocado cambiaba el monto sin que el usuario lo notara.
 *
 * Este componente muestra `1.250.000` mientras se escribe y entrega un número
 * al padre. Es `type="text"` con `inputMode="numeric"`, así que en celular
 * abre el teclado numérico igual.
 */
export function MoneyInput({
  value,
  onChange,
  className = '',
  placeholder,
  disabled,
  required,
  id,
  'aria-label': ariaLabel,
}: {
  /** Monto actual. `''` representa vacío (aún sin escribir). */
  value: number | '';
  onChange: (valor: number | '') => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  const texto = value === '' ? '' : formatMoneyInput(String(value));

  return (
    <div className="relative w-full">
      {/* `text-xs` explícito: sin él el `$` hereda el tamaño del modal que lo
          contiene, así que su ancho cambia según dónde se use y el `pl-7` del
          input deja de calzar. */}
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-neutral-600 select-none">
        $
      </span>
      <input
        id={id}
        aria-label={ariaLabel}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={texto}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        onChange={(e) => {
          const limpio = e.target.value.replace(/\D/g, '');
          onChange(limpio === '' ? '' : parseMoney(limpio));
        }}
        className={`${className} pl-7`}
      />
    </div>
  );
}
