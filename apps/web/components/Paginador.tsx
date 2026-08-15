'use client';

import React, { useEffect, useMemo, useState } from 'react';

/**
 * Paginación de RENDERIZADO para listas largas.
 *
 * Por qué no es paginación de servidor: hoy `page.tsx` usa esas mismas listas
 * como tablas de búsqueda (`customers.find` en 13 sitios, `products.find` en
 * 12) y como origen de los desplegables. Si el servidor devolviera solo una
 * página, los nombres de cliente y producto empezarían a aparecer vacíos en
 * media app. La paginación real va junto con el ruteo por módulo, cuando cada
 * pantalla pida sus propios datos.
 *
 * Mientras tanto esto resuelve el costo que sí se siente: a 500 filas el
 * navegador dejaba de renderizar 500 nodos y de re-renderizarlos en cada
 * tecleo de cualquier formulario.
 */
export function usePaginacion<T>(items: T[], porPagina = 25) {
  const [pagina, setPagina] = useState(1);
  const totalPaginas = Math.max(1, Math.ceil(items.length / porPagina));

  // Si la lista se achica (por un filtro), no quedarse en una página vacía.
  useEffect(() => {
    if (pagina > totalPaginas) setPagina(1);
  }, [pagina, totalPaginas]);

  const visibles = useMemo(
    () => items.slice((pagina - 1) * porPagina, pagina * porPagina),
    [items, pagina, porPagina],
  );

  return { visibles, pagina, setPagina, totalPaginas, total: items.length, porPagina };
}

export function Paginador({
  pagina,
  setPagina,
  totalPaginas,
  total,
  porPagina,
  etiqueta = 'registros',
}: {
  pagina: number;
  setPagina: (p: number) => void;
  totalPaginas: number;
  total: number;
  porPagina: number;
  etiqueta?: string;
}) {
  if (total <= porPagina) return null;

  const desde = (pagina - 1) * porPagina + 1;
  const hasta = Math.min(pagina * porPagina, total);

  return (
    <nav
      aria-label={`Paginación de ${etiqueta}`}
      className="flex items-center justify-between gap-3 border-t border-neutral-200 pt-3 mt-3 flex-wrap"
    >
      <span className="font-mono text-[11px] text-neutral-600">
        {desde}–{hasta} de {total} {etiqueta}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setPagina(pagina - 1)}
          disabled={pagina === 1}
          className="neo-btn px-2.5 py-1.5 font-mono text-[11px] font-bold disabled:opacity-40"
        >
          ← Anterior
        </button>
        <span className="font-mono text-[11px] text-neutral-600 px-1">
          {pagina} / {totalPaginas}
        </span>
        <button
          type="button"
          onClick={() => setPagina(pagina + 1)}
          disabled={pagina === totalPaginas}
          className="neo-btn px-2.5 py-1.5 font-mono text-[11px] font-bold disabled:opacity-40"
        >
          Siguiente →
        </button>
      </div>
    </nav>
  );
}
