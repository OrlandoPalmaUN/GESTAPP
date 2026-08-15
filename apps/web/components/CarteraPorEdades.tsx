'use client';

import React, { useEffect, useState } from 'react';
import { api, ApiError, type Cartera } from '../lib/api';
import { money } from '../lib/format';

const CUBETAS = [
  { key: 'porVencer', label: 'Por vencer', clase: 'text-neutral-700' },
  { key: 'd1a30', label: '1-30 días', clase: 'text-yellow-700' },
  { key: 'd31a60', label: '31-60 días', clase: 'text-orange-700' },
  { key: 'd61a90', label: '61-90 días', clase: 'text-red-600' },
  { key: 'dMas90', label: '+90 días', clase: 'text-brand-red font-black' },
] as const;

/**
 * Cartera por edades — la vista con la que efectivamente se cobra.
 *
 * Antes solo existía la lista plana de facturas: para saber a quién llamar
 * primero había que abrir una por una y hacer la cuenta de cabeza. Acá cada
 * cliente aparece con su deuda repartida por antigüedad, ordenado por lo que
 * más pesa, y el corte de +90 días marcado en rojo porque es donde la
 * probabilidad de cobrar se cae.
 */
export function CarteraPorEdades({ tipo }: { tipo: 'cxc' | 'cxp' }) {
  const [datos, setDatos] = useState<Cartera | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError(null);
    void (async () => {
      try {
        const d = await api.cartera(tipo);
        if (vigente) setDatos(d);
      } catch (e) {
        if (vigente) setError(e instanceof ApiError ? e.message : 'No se pudo cargar la cartera.');
      } finally {
        if (vigente) setCargando(false);
      }
    })();
    return () => { vigente = false; };
  }, [tipo]);

  const quien = tipo === 'cxc' ? 'Cliente' : 'Proveedor';

  if (cargando) {
    return <div className="neo-card bg-white font-mono text-xs text-neutral-600">Cargando cartera…</div>;
  }
  if (error) {
    return <div className="neo-card bg-white font-mono text-xs text-brand-red">{error}</div>;
  }
  if (!datos || datos.filas.length === 0) {
    return (
      <div className="neo-card bg-white">
        <h3 className="font-mono text-xs font-bold border-b border-black pb-2 mb-3">
          CARTERA POR EDADES
        </h3>
        <p className="text-xs text-neutral-600 italic text-center py-4">
          {tipo === 'cxc' ? 'Nadie te debe nada en este momento.' : 'No le debés nada a ningún proveedor.'}
        </p>
      </div>
    );
  }

  return (
    <div className="neo-card bg-white">
      <div className="flex items-baseline justify-between border-b border-black pb-2 mb-3 gap-3">
        <h3 className="font-mono text-xs font-bold">CARTERA POR EDADES</h3>
        <span className="font-mono text-[11px] text-neutral-600">
          {datos.filas.length} {quien.toLowerCase()}{datos.filas.length !== 1 ? 's' : ''} · total {money(datos.totales.total)}
        </span>
      </div>

      {/* Totales por cubeta — el resumen que se mira primero. */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        {CUBETAS.map((c) => (
          <div key={c.key} className="border border-black p-2 bg-neutral-50">
            <div className="font-mono text-[11px] text-neutral-600 font-bold">{c.label}</div>
            <div className={`font-mono font-black text-sm ${c.clase}`}>{money(datos.totales[c.key])}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b-2 border-black font-mono text-[11px] text-neutral-600">
              <th className="text-left p-2">{quien.toUpperCase()}</th>
              {CUBETAS.map((c) => (
                <th key={c.key} className="text-right p-2 whitespace-nowrap">{c.label}</th>
              ))}
              <th className="text-right p-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {datos.filas.map((f) => (
              <tr key={f.contraparteId ?? f.contraparte} className="border-b border-neutral-200 hover:bg-neutral-50">
                <td className="p-2">
                  <div className="font-bold text-black">{f.contraparte}</div>
                  <div className="font-mono text-[11px] text-neutral-600">
                    {f.facturas} factura{f.facturas !== 1 ? 's' : ''}
                    {f.diasMasVieja > 0 && ` · la más vieja hace ${f.diasMasVieja} días`}
                  </div>
                </td>
                {CUBETAS.map((c) => (
                  <td key={c.key} className={`p-2 text-right font-mono whitespace-nowrap ${f[c.key] > 0 ? c.clase : 'text-neutral-300'}`}>
                    {f[c.key] > 0 ? money(f[c.key]) : '—'}
                  </td>
                ))}
                <td className="p-2 text-right font-mono font-black whitespace-nowrap">{money(f.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
