-- Migración 029 — costo promedio ponderado móvil por producto.
--
-- `productos.precio_costo` lo teclea una persona y queda congelado, así que el
-- margen se compara contra un número inventado: si el queso subió de precio hace
-- tres compras, la app sigue creyendo que cuesta lo de antes y muestra una
-- ganancia que no existe.
--
-- El costo tiene que salir de lo que REALMENTE se pagó. Y la buena noticia es
-- que ese dato ya está en la base: cada recepción de OC y cada compra directa
-- escriben `movimientos_inventario.precio_unitario` con el precio real (ver
-- routes/tenant/pedidos_proveedor.ts). Nunca se usó para nada. Esta migración
-- solo lo aprovecha.
--
-- ── Método: promedio ponderado móvil ───────────────────────────────────────
--   costo_nuevo = (stock_previo × costo_previo + cantidad_entrada × costo_entrada)
--                 / (stock_previo + cantidad_entrada)
--
-- Con 10 libras a $8.000 y una entrada de 18 a $7.500, el costo queda en $7.680
-- — lo que de verdad vale lo que hay en la nevera. Se descartó "último costo"
-- (una compra chica y cara movería el margen de todo el stock viejo) y FIFO por
-- capas (obliga a una tabla de lotes y a reescribir el cálculo de stock; es
-- sobre-ingeniería para una tienda de barrio).
--
-- ── Qué recalcula y qué no ────────────────────────────────────────────────
--   entrada_compra, entrada_produccion → SÍ. Traen un costo real.
--   ajuste_positivo                    → NO. Un conteo físico no tiene precio;
--                                        contar la nevera no debe mover el margen.
--   entrada_devolucion                 → NO. Vuelve con el costo con que salió.
--   cualquier salida                   → NO. Sacar unidades no cambia el unitario.
--
-- ── Por qué `precio_costo` NO se borra ────────────────────────────────────
-- Un producto recién creado todavía no tiene ninguna compra, y sin un costo
-- manual no habría margen que mostrar el primer día. Así que conviven:
--   precio_costo    → costo manual de referencia, lo teclea el usuario.
--   costo_promedio  → calculado; NULL hasta que haya una entrada con costo.
-- El costo efectivo es COALESCE(costo_promedio, precio_costo): cuando llega la
-- primera compra, el calculado toma el mando solo. Además deja camino de vuelta
-- si el cálculo sale mal.
--
-- Lo que esta migración NO toca: `pedido_items.precio_costo`. Ese es el snapshot
-- congelado al vender (migración 007) y es justamente lo que permite que el
-- costo del catálogo cambie sin reescribir la historia. El margen de un pedido
-- viejo no se mueve.

ALTER TABLE productos ADD COLUMN IF NOT EXISTS costo_promedio NUMERIC(12,2);

ALTER TABLE productos DROP CONSTRAINT IF EXISTS costo_promedio_no_negativo;
ALTER TABLE productos ADD CONSTRAINT costo_promedio_no_negativo
  CHECK (costo_promedio IS NULL OR costo_promedio >= 0);

-- ── Backfill ───────────────────────────────────────────────────────────────
-- Recorre las entradas con costo de cada producto en orden cronológico y aplica
-- la fórmula, igual que lo hará la API de ahora en adelante. Es el mayor valor
-- inmediato de esta migración: al aplicarla, cada producto que ya tenga compras
-- queda con su costo real sin que nadie teclee un dato.
--
-- Se hace con un cursor en PL/pgSQL y no con una window function porque el
-- promedio ponderado es RECURSIVO: cada paso necesita el resultado del anterior,
-- y eso no se expresa con SUM() OVER ().
DO $$
DECLARE
  prod RECORD;
  mov  RECORD;
  acum_cantidad NUMERIC(14,2);
  acum_costo    NUMERIC(14,4);
BEGIN
  FOR prod IN SELECT id FROM productos LOOP
    acum_cantidad := 0;
    acum_costo    := NULL;

    FOR mov IN
      SELECT cantidad, precio_unitario
      FROM movimientos_inventario
      WHERE producto_id = prod.id
        AND tipo = 'entrada_compra'
        AND precio_unitario IS NOT NULL
        AND precio_unitario > 0
      ORDER BY created_at
    LOOP
      IF acum_costo IS NULL THEN
        acum_costo    := mov.precio_unitario;
        acum_cantidad := mov.cantidad;
      ELSE
        -- Ponderado: el costo viejo pesa por el stock acumulado, el nuevo por lo que entra.
        acum_costo := ((acum_cantidad * acum_costo) + (mov.cantidad * mov.precio_unitario))
                      / NULLIF(acum_cantidad + mov.cantidad, 0);
        acum_cantidad := acum_cantidad + mov.cantidad;
      END IF;
    END LOOP;

    IF acum_costo IS NOT NULL THEN
      UPDATE productos SET costo_promedio = ROUND(acum_costo, 2) WHERE id = prod.id;
    END IF;
  END LOOP;
END $$;
