/**
 * Vitrina — el inventario visto como piezas contables en vez de una columna
 * de números.
 *
 * Para un negocio con pocos productos y cantidades bajas, "ver" cuánto queda
 * es más rápido que leerlo, y sobre todo hace evidente lo que FALTA: los
 * huecos punteados marcan la distancia hasta el stock mínimo.
 *
 * El modo "Contar" existe porque el conteo físico era un formulario de
 * movimiento de inventario. Aquí se toca hasta que la pantalla coincide con
 * la nevera y se guarda una sola vez — un único `ajuste_positivo`/
 * `ajuste_negativo` con la diferencia, no un movimiento por toque.
 */
'use client';

import { useState } from 'react';

import { ProductSprite } from './ProductSprite';

import type { Product } from '@/lib/mockData';

/** Tope de piezas dibujadas por producto. Más allá, contar de un vistazo deja de funcionar y solo cuesta DOM. */
const MAX_PIEZAS = 24;

/** Escalas candidatas cuando el producto no define una (`sprite_escala` null). */
const ESCALAS = [1, 5, 10, 25, 50, 100] as const;

/**
 * Cuántas unidades representa cada pieza. Si el producto no lo define, se
 * elige la escala más pequeña que mantenga el dibujo por debajo de
 * `MAX_PIEZAS` — así la Vitrina funciona sin configurar nada, y 300 arepas no
 * intentan dibujar 300 sprites.
 */
function escalaEfectiva(producto: Product, stock: number): number {
  if (producto.sprite_escala && producto.sprite_escala > 0) return producto.sprite_escala;
  const referencia = Math.max(stock, producto.stock_minimo);
  return ESCALAS.find((e) => referencia / e <= MAX_PIEZAS) ?? 100;
}

interface StockVitrinaProps {
  productos: Product[];
  stockPorId: Record<string, number>;
  /** Guarda el conteo físico: `diferencia` puede ser negativa (faltó) o positiva (sobró). */
  onAjustar: (producto: Product, diferencia: number) => Promise<void>;
}

export function StockVitrina({ productos, stockPorId, onAjustar }: StockVitrinaProps) {
  if (productos.length === 0) {
    return (
      <div className="neo-card bg-white p-6 text-center text-xs font-mono text-neutral-500">
        No hay productos que coincidan con el filtro.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {productos.map((p) => (
        <TarjetaProducto key={p.id} producto={p} stock={stockPorId[p.id] ?? 0} onAjustar={onAjustar} />
      ))}
    </div>
  );
}

function TarjetaProducto({
  producto,
  stock,
  onAjustar,
}: {
  producto: Product;
  stock: number;
  onAjustar: (producto: Product, diferencia: number) => Promise<void>;
}) {
  const [contando, setContando] = useState(false);
  const [conteo, setConteo] = useState(stock);
  const [guardando, setGuardando] = useState(false);

  const escala = escalaEfectiva(producto, stock);
  // En modo conteo la rejilla refleja lo que se lleva contado, no lo guardado.
  const mostrado = contando ? conteo : stock;
  const bajoMinimo = mostrado < producto.stock_minimo;

  const piezas = mostrado / escala;
  const enteras = Math.min(Math.floor(piezas), MAX_PIEZAS);
  // Solo dibujamos media pieza si la fracción se nota: 12.05 libras redondea
  // a 12 sprites, 12.5 sí muestra la mitad.
  const media = piezas - Math.floor(piezas) >= 0.25 && enteras < MAX_PIEZAS;
  const truncado = Math.floor(piezas) > MAX_PIEZAS;

  // Huecos hasta el mínimo — lo que hay que reponer, dibujado como ausencia.
  const faltantes = bajoMinimo
    ? Math.min(Math.ceil((producto.stock_minimo - mostrado) / escala), MAX_PIEZAS - enteras)
    : 0;

  const diferencia = conteo - stock;

  const iniciarConteo = () => {
    setConteo(stock);
    setContando(true);
  };

  const guardar = async () => {
    if (diferencia === 0) {
      setContando(false);
      return;
    }
    setGuardando(true);
    try {
      await onAjustar(producto, diferencia);
      setContando(false);
    } finally {
      setGuardando(false);
    }
  };

  const ajustarConteo = (delta: number) => {
    setConteo((actual) => Math.max(0, Number((actual + delta).toFixed(2))));
  };

  return (
    <div className={`neo-card bg-white p-0 overflow-hidden ${bajoMinimo ? 'border-brand-red' : ''}`}>
      <div
        className={`flex items-baseline justify-between gap-2 px-3 py-2 border-b-2 ${
          bajoMinimo ? 'bg-brand-red text-white border-brand-red' : 'border-black'
        }`}
      >
        <span className="font-mono text-[11px] font-bold uppercase truncate">{producto.nombre}</span>
        <span className="font-mono text-xs font-bold whitespace-nowrap">
          {mostrado} {producto.unidad}
        </span>
      </div>

      <div className="flex flex-wrap gap-1 p-2.5 min-h-[76px] content-start">
        {Array.from({ length: enteras }).map((_, i) => (
          <PiezaSprite
            key={`p${i}`}
            producto={producto}
            // Solo la última pieza responde al toque: quitar del medio y que
            // se reacomode todo se siente como si hubiera borrado otra cosa.
            interactiva={contando && !media && i === enteras - 1}
            onClick={() => ajustarConteo(-escala)}
          />
        ))}
        {media && (
          <PiezaSprite
            producto={producto}
            mitad
            interactiva={contando}
            onClick={() => ajustarConteo(-(escala / 2))}
          />
        )}
        {Array.from({ length: faltantes }).map((_, i) => (
          <span
            key={`f${i}`}
            aria-hidden
            className="inline-block w-[30px] h-[30px] border border-dashed border-brand-red opacity-50"
          />
        ))}
        {truncado && (
          <span className="self-center font-mono text-[10px] text-neutral-500">
            +{Math.floor(piezas) - MAX_PIEZAS} más
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-t border-black font-mono text-[10px]">
        <span className="text-neutral-500">
          {escala === 1 ? `1 dibujo = 1 ${producto.unidad}` : `1 dibujo = ${escala} ${producto.unidad}`}
        </span>
        {bajoMinimo ? (
          <span className="text-brand-red font-bold whitespace-nowrap">
            Faltan {Number((producto.stock_minimo - mostrado).toFixed(2))}
          </span>
        ) : (
          <span className="text-neutral-500 whitespace-nowrap">Mín: {producto.stock_minimo}</span>
        )}
      </div>

      {!contando ? (
        <button
          type="button"
          onClick={iniciarConteo}
          className="w-full border-t-2 border-black py-2 font-mono text-[10px] font-bold uppercase tracking-wider hover:bg-neutral-50"
        >
          Contar
        </button>
      ) : (
        <div className="border-t-2 border-black bg-neutral-50 p-2 flex flex-col gap-2">
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => ajustarConteo(-escala)}
              className="neo-btn px-3 py-1 font-mono font-bold"
              aria-label={`Quitar ${escala}`}
            >
              −
            </button>
            <span className="font-mono text-xs font-bold tabular-nums min-w-[92px] text-center">
              {stock} → {conteo}
            </span>
            <button
              type="button"
              onClick={() => ajustarConteo(escala)}
              className="neo-btn px-3 py-1 font-mono font-bold"
              aria-label={`Agregar ${escala}`}
            >
              +
            </button>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={guardando}
              onClick={() => void guardar()}
              className="neo-btn bg-brand-blue text-white flex-1 py-1.5 font-mono text-[10px] font-bold uppercase disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : diferencia === 0 ? 'Sin cambios' : 'Guardar conteo'}
            </button>
            <button
              type="button"
              disabled={guardando}
              onClick={() => setContando(false)}
              className="neo-btn px-3 py-1.5 font-mono text-[10px] uppercase disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PiezaSprite({
  producto,
  mitad = false,
  interactiva,
  onClick,
}: {
  producto: Product;
  mitad?: boolean;
  interactiva: boolean;
  onClick: () => void;
}) {
  const sprite = <ProductSprite sprite={producto.sprite} size={30} mitad={mitad} />;
  if (!interactiva) return sprite;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Quitar una pieza de ${producto.nombre}`}
      className="hover:opacity-40 transition-opacity leading-none"
    >
      {sprite}
    </button>
  );
}
