'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ChevronDown } from 'lucide-react';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Segunda línea, más chica (SKU, disponible, NIT, etc.) — también entra en la búsqueda. */
  sublabel?: string;
  disabled?: boolean;
}

const MAX_VISIBLE = 50;

/**
 * Selector con búsqueda para listas largas (productos, clientes) que ya están
 * cargadas en memoria — sin llamar a la API, a diferencia de `BuscadorGlobal`.
 *
 * Reemplaza un `<select>` con cientos de `<option>` (Crear Pedido obligaba a
 * scrollear todo el catálogo/cartera de clientes para encontrar uno) por un
 * input que filtra en vivo por nombre y por `sublabel` (SKU, disponible, NIT).
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Buscar…',
  emptyOptionLabel,
  className = '',
  autoFocus = false,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  /** Si se pasa, agrega una opción con value='' al principio (ej. "— Sin cliente —"). */
  emptyOptionLabel?: string;
  className?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const todasLasOpciones = useMemo<ComboboxOption[]>(
    () => (emptyOptionLabel !== undefined ? [{ value: '', label: emptyOptionLabel }, ...options] : options),
    [options, emptyOptionLabel],
  );

  const seleccionada = todasLasOpciones.find((o) => o.value === value) ?? null;

  const filtradas = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return todasLasOpciones;
    return todasLasOpciones.filter(
      (o) => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q),
    );
  }, [todasLasOpciones, query]);

  const visibles = filtradas.slice(0, MAX_VISIBLE);

  // Cerrar al hacer clic afuera — mismo patrón que BuscadorGlobal.
  useEffect(() => {
    function onClickFuera(e: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onClickFuera);
    return () => document.removeEventListener('mousedown', onClickFuera);
  }, []);

  const elegir = (opt: ComboboxOption) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setQuery('');
    setOpen(false);
  };

  const abrir = () => {
    setOpen(true);
    setHighlighted(0);
    inputRef.current?.select();
  };

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <div ref={contenedorRef} className={`relative ${className}`}>
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          value={open ? query : (seleccionada?.label ?? '')}
          onFocus={abrir}
          onClick={abrir}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlighted(0); }}
          placeholder={seleccionada ? seleccionada.label : placeholder}
          className="neo-input w-full pl-8 pr-8 disabled:bg-neutral-100 disabled:text-neutral-500"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlighted((h) => Math.min(h + 1, visibles.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); const opt = visibles[highlighted]; if (opt) elegir(opt); }
            else if (e.key === 'Escape') { setOpen(false); setQuery(''); inputRef.current?.blur(); }
          }}
        />
        <ChevronDown size={14} className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>

      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto border-2 border-black bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
          {visibles.length === 0 && (
            <p className="px-3 py-3 text-[11px] font-mono text-neutral-500 italic text-center">Sin resultados.</p>
          )}
          {visibles.map((opt, i) => (
            <button
              key={opt.value || '__empty__'}
              type="button"
              disabled={opt.disabled}
              onClick={() => elegir(opt)}
              onMouseEnter={() => setHighlighted(i)}
              className={`w-full text-left px-3 py-2 text-xs border-b border-neutral-100 last:border-0 flex items-center justify-between gap-2 ${
                opt.disabled ? 'opacity-40 cursor-not-allowed'
                  : i === highlighted ? 'bg-brand-blue text-white' : 'hover:bg-neutral-50'
              } ${opt.value === value ? 'font-bold' : ''}`}
            >
              <span className="truncate">{opt.label}</span>
              {opt.sublabel && (
                <span className={`shrink-0 font-mono text-[11px] ${i === highlighted ? 'text-white/80' : 'text-neutral-500'}`}>{opt.sublabel}</span>
              )}
            </button>
          ))}
          {filtradas.length > MAX_VISIBLE && (
            <p className="px-3 py-1.5 text-[11px] font-mono text-neutral-500 italic text-center border-t border-neutral-100">
              +{filtradas.length - MAX_VISIBLE} más — seguí escribiendo para acotar
            </p>
          )}
        </div>
      )}
    </div>
  );
}
