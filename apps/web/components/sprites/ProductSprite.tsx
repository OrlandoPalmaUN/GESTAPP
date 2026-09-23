/**
 * Dibuja la ilustración de un producto. Es SVG puro: escala a cualquier
 * tamaño sin perder el borde duro del pixel art (`shapeRendering` en
 * `crispEdges` desactiva el antialiasing, que es justo lo que arruina el
 * look de 16×16 al agrandarlo).
 */
import { SPRITE_POR_DEFECTO, tramosDe } from './pixelSprites';

import type { SpriteProducto } from '@antigravity/shared';

interface ProductSpriteProps {
  /** null = se dibuja la caja genérica (producto sin ilustración asignada). */
  sprite: SpriteProducto | null;
  /** Lado en píxeles. El sprite es cuadrado. */
  size?: number;
  /**
   * Recorta el sprite por la mitad, para representar media unidad — media
   * libra de queso, por ejemplo. El stock es NUMERIC(12,2), así que las
   * fracciones son datos reales, no un adorno.
   */
  mitad?: boolean;
  className?: string;
  /** Texto accesible. Sin él, el sprite queda oculto para lectores de pantalla. */
  titulo?: string;
}

export function ProductSprite({ sprite, size = 32, mitad = false, className, titulo }: ProductSpriteProps) {
  const clave = sprite ?? SPRITE_POR_DEFECTO;
  const tramos = tramosDe(clave);

  const svg = (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role={titulo ? 'img' : undefined}
      aria-hidden={titulo ? undefined : true}
      className={mitad ? undefined : className}
    >
      {titulo ? <title>{titulo}</title> : null}
      {tramos.map((t, i) => (
        <rect key={i} x={t.x} y={t.y} width={t.ancho} height={1} fill={t.color} />
      ))}
    </svg>
  );

  if (!mitad) return svg;

  // El recorte va en un contenedor y no en el propio SVG: reducir el ancho
  // del SVG lo ESCALARÍA (saldría un sprite flaco) en vez de cortarlo.
  return (
    <span
      className={className}
      style={{ display: 'inline-block', width: size / 2, height: size, overflow: 'hidden' }}
    >
      {svg}
    </span>
  );
}
