'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api, type ResultadoBusqueda } from '../lib/api';

const ETIQUETA_TIPO: Record<ResultadoBusqueda['tipo'], string> = {
  cliente: 'Cliente',
  producto: 'Producto',
  proveedor: 'Proveedor',
  pedido: 'Pedido',
  compra: 'Compra / OC',
  factura_venta: 'CxC',
  factura_compra: 'CxP',
};

/**
 * Búsqueda global desde el header.
 *
 * `GET /buscar` ya existía en el backend (busca en clientes, productos,
 * proveedores, pedidos, OC y facturas de venta y compra) pero el frontend
 * nunca lo llamaba: la única caja de búsqueda de la app estaba en Inventario
 * y solo miraba nombre y SKU. En los demás módulos —Pedidos, Clientes,
 * Gastos, Facturas— la única herramienta para encontrar algo era scrollear.
 */
export function BuscadorGlobal({
  onIrA,
}: {
  /** Lleva al módulo correspondiente al resultado elegido. */
  onIrA: (r: ResultadoBusqueda) => void;
}) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<ResultadoBusqueda[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);

  // Debounce: no dispara una consulta por cada tecla.
  useEffect(() => {
    const termino = q.trim();
    if (termino.length < 2) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const { resultados } = await api.buscarGlobal(termino);
        setResultados(resultados);
        setAbierto(true);
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Cerrar al hacer clic afuera.
  useEffect(() => {
    if (!abierto) return;
    const onClick = (e: MouseEvent) => {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [abierto]);

  const limpiar = () => { setQ(''); setResultados([]); setAbierto(false); };

  return (
    <div ref={contenedorRef} className="relative w-full max-w-xs">
      <label htmlFor="buscador-global" className="sr-only">Buscar en toda la empresa</label>
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-600" />
      <input
        id="buscador-global"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => { if (resultados.length > 0) setAbierto(true); }}
        onKeyDown={(e) => { if (e.key === 'Escape') limpiar(); }}
        placeholder="Buscar cliente, producto, pedido…"
        className="neo-input w-full pl-8 pr-7 py-1.5 text-xs font-mono"
      />
      {q && (
        <button
          type="button"
          onClick={limpiar}
          aria-label="Limpiar búsqueda"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-600 hover:text-black"
        >
          <X size={13} />
        </button>
      )}

      {abierto && q.trim().length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border-2 border-black max-h-80 overflow-y-auto z-50 shadow-lg">
          {buscando && resultados.length === 0 && (
            <p className="px-3 py-2 font-mono text-xs text-neutral-600">Buscando…</p>
          )}
          {!buscando && resultados.length === 0 && (
            <p className="px-3 py-2 font-mono text-xs text-neutral-600">
              Sin resultados para «{q.trim()}»
            </p>
          )}
          {resultados.map((r) => (
            <button
              key={`${r.tipo}-${r.id}`}
              type="button"
              onClick={() => { onIrA(r); limpiar(); }}
              className="w-full text-left px-3 py-2 border-b border-neutral-200 last:border-b-0 hover:bg-neutral-50 flex items-center gap-2"
            >
              <span className="font-mono text-[11px] font-bold border border-black px-1 shrink-0">
                {ETIQUETA_TIPO[r.tipo]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold text-black truncate">{r.etiqueta}</span>
                {r.subtitulo && (
                  <span className="block font-mono text-[11px] text-neutral-600 truncate">{r.subtitulo}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
