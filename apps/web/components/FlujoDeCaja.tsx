'use client';

import React, { useEffect, useState } from 'react';
import { api, ApiError, type DesgloseFlujoCaja, type PeriodoFlujoCaja } from '../lib/api';
import { money } from '../lib/format';

/**
 * Flujo de Caja proyectado por período quincenal.
 *
 * Reemplaza el foco anterior en Reportes/Actividad/Redes (pausados) con una
 * vista de "qué va a pasar con la plata" hacia adelante: cada celda separa lo
 * ya confirmado (columna sólida) de lo todavía pendiente (columna en cursiva)
 * — proyectado viene ÚNICAMENTE de CxC/CxP con saldo pendiente bucketeadas
 * por su fecha de vencimiento (GET /finanzas/flujo-caja), sin inventar datos.
 */

/**
 * Filas fijas del cuadro. `gastosAdministrativos` e `ingresos` YA NO se pintan
 * como una sola línea: se abren por categoría del negocio (migración 027) a
 * partir de `desglose`. Lo que queda fijo es lo que no sale de
 * `gastos_operativos`/`ingresos_bancarios` y por lo tanto no tiene categoría:
 * los costos operativos son CxP pagada a proveedores.
 */
const FILAS_FIJAS = [
  { key: 'costosOperativos', label: 'Costos operativos (proveedores)', signo: -1 as const },
] as const;

function celda(actual: number, proyectado: number, signo: 1 | -1) {
  if (actual === 0 && proyectado === 0) {
    return <span className="text-neutral-400">—</span>;
  }
  const fmt = (n: number) => (signo === -1 && n > 0 ? `(${money(n)})` : money(n));
  return (
    <div className="flex flex-col items-end leading-tight">
      {actual !== 0 && (
        <span className={signo === -1 ? 'text-brand-red font-bold' : 'text-green-700 font-bold'}>
          {fmt(actual)}
        </span>
      )}
      {proyectado !== 0 && (
        <span className={`italic text-[11px] ${signo === -1 ? 'text-amber-600' : 'text-blue-600'}`}>
          {fmt(proyectado)}
        </span>
      )}
    </div>
  );
}

export function FlujoDeCaja() {
  const [periodos, setPeriodos] = useState<PeriodoFlujoCaja[] | null>(null);
  const [desglose, setDesglose] = useState<DesgloseFlujoCaja | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError(null);
    void (async () => {
      try {
        const { periodos, desglose } = await api.flujoCaja();
        if (vigente) { setPeriodos(periodos); setDesglose(desglose ?? null); }
      } catch (e) {
        if (vigente) setError(e instanceof ApiError ? e.message : 'No se pudo cargar el flujo de caja.');
      } finally {
        if (vigente) setCargando(false);
      }
    })();
    return () => { vigente = false; };
  }, []);

  if (cargando) {
    return <div className="neo-card bg-white font-mono text-xs text-neutral-600">Cargando flujo de caja…</div>;
  }
  if (error) {
    return <div className="neo-card bg-white font-mono text-xs text-brand-red">{error}</div>;
  }
  if (!periodos || periodos.length === 0) {
    return <div className="neo-card bg-white font-mono text-xs text-neutral-600">Sin datos para proyectar todavía.</div>;
  }

  return (
    <div className="neo-card bg-white p-0 overflow-hidden">
      <div className="flex items-center justify-between border-b-2 border-black p-3">
        <h3 className="font-mono text-sm font-bold">FLUJO DE CAJA</h3>
        <span className="font-mono text-[11px] text-neutral-600 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
          Proyectado (pendiente)
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-[900px] w-full">
          <thead>
            <tr className="border-b border-neutral-300">
              <th className="text-left p-2 font-mono text-neutral-600 sticky left-0 bg-white">CATEGORÍA</th>
              {periodos.map((p) => (
                <th key={p.desde} className="text-right p-2 font-mono text-neutral-600 whitespace-nowrap">
                  {p.label.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FILAS_FIJAS.map((fila) => (
              <tr key={fila.key} className="border-b border-neutral-200">
                <td className="p-2 font-bold sticky left-0 bg-white">{fila.label}</td>
                {periodos.map((p) => {
                  const v = p[fila.key];
                  return (
                    <td key={p.desde} className="p-2 text-right">
                      {celda(v.actual, v.proyectado, fila.signo)}
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* Gastos, abiertos por las categorías que el negocio definió.
                Solo aparecen las que tienen movimiento en el rango: mostrar el
                catálogo entero en cero haría la tabla ilegible. */}
            {desglose && desglose.egresos.length > 0 && (
              <tr className="bg-neutral-50/60">
                <td colSpan={periodos.length + 1} className="px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                  Gastos por categoría
                </td>
              </tr>
            )}
            {desglose?.egresos.map((cat) => (
              <tr key={cat.categoriaId ?? 'sin-cat-egreso'} className="border-b border-neutral-200">
                <td className="p-2 pl-4 sticky left-0 bg-white">
                  {cat.nombre}
                  {!cat.afectaUtilidad && (
                    <span className="ml-1.5 font-mono text-[9px] text-neutral-500 border border-neutral-400 px-1" title="No afecta la utilidad — mueve plata pero no es operativo">
                      no operativa
                    </span>
                  )}
                </td>
                {periodos.map((p, i) => (
                  <td key={p.desde} className="p-2 text-right">
                    {celda(cat.actual[i] ?? 0, cat.proyectado[i] ?? 0, -1)}
                  </td>
                ))}
              </tr>
            ))}

            {desglose && desglose.ingresos.length > 0 && (
              <tr className="bg-neutral-50/60">
                <td colSpan={periodos.length + 1} className="px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                  Ingresos por categoría
                </td>
              </tr>
            )}
            {desglose?.ingresos.map((cat) => (
              <tr key={cat.categoriaId ?? 'sin-cat-ingreso'} className="border-b border-neutral-200">
                <td className="p-2 pl-4 sticky left-0 bg-white">
                  {cat.nombre}
                  {!cat.afectaUtilidad && (
                    <span className="ml-1.5 font-mono text-[9px] text-neutral-500 border border-neutral-400 px-1" title="No afecta la utilidad — mueve plata pero no es operativo">
                      no operativa
                    </span>
                  )}
                </td>
                {periodos.map((p, i) => (
                  <td key={p.desde} className="p-2 text-right">
                    {celda(cat.actual[i] ?? 0, cat.proyectado[i] ?? 0, 1)}
                  </td>
                ))}
              </tr>
            ))}

            <tr className="border-t-2 border-black bg-neutral-50">
              <td className="p-2 font-bold sticky left-0 bg-neutral-50">Total egresos</td>
              {periodos.map((p) => (
                <td key={p.desde} className="p-2 text-right font-mono text-brand-red">
                  {p.totalEgresos > 0 ? `(${money(p.totalEgresos)})` : <span className="text-neutral-400">—</span>}
                </td>
              ))}
            </tr>
            <tr className="bg-neutral-50">
              <td className="p-2 font-bold sticky left-0 bg-neutral-50">Ingresos</td>
              {periodos.map((p) => (
                <td key={p.desde} className="p-2 text-right font-mono text-green-700">
                  {p.totalIngresos > 0 ? money(p.totalIngresos) : <span className="text-neutral-400">—</span>}
                </td>
              ))}
            </tr>
            <tr className="border-b-2 border-black bg-neutral-50">
              <td className="p-2 font-bold sticky left-0 bg-neutral-50">Saldo del período</td>
              {periodos.map((p) => (
                <td key={p.desde} className={`p-2 text-right font-mono font-bold ${p.saldoDelPeriodo >= 0 ? 'text-blue-700' : 'text-brand-red'}`}>
                  {money(p.saldoDelPeriodo)}
                </td>
              ))}
            </tr>

            <tr className="border-t-2 border-orange-500">
              <td className="p-2 font-bold text-orange-700 sticky left-0 bg-white">Saldo en banco</td>
              {periodos.map((p) => (
                <td key={p.desde} className="p-2 text-right font-mono font-bold text-orange-700">
                  {money(p.saldoEnBanco)}
                </td>
              ))}
            </tr>
            <tr>
              <td className="p-2 font-bold text-orange-700 sticky left-0 bg-white">Flujo de caja acumulado</td>
              {periodos.map((p) => (
                <td key={p.desde} className="p-2 text-right font-mono font-bold text-orange-700">
                  {money(p.flujoAcumulado)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="p-2 border-t border-neutral-200 text-[11px] text-neutral-600">
        Lo proyectado sale de cuentas por cobrar/pagar con saldo pendiente, según su fecha de vencimiento —
        nunca es un número inventado: si no hay una factura pendiente para esa fecha, no hay proyección.
        Las categorías son las que configuraste en Configuración; las marcadas &quot;no operativa&quot; mueven
        plata pero no cuentan como ganancia ni pérdida del negocio.
      </p>
    </div>
  );
}
