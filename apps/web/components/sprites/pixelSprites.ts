/**
 * Catálogo de ilustraciones de producto — pixel art de 16×16 dibujado a mano.
 *
 * Por qué mapas de texto y no imágenes: cada sprite pesa menos de 1 KB, se
 * versiona en git como cualquier otro código, escala sin perder nitidez (son
 * rectángulos SVG, no píxeles rasterizados) y se recolorea cambiando una
 * entrada de la paleta. Además el stack no tiene almacenamiento de archivos,
 * así que un PNG exigiría infraestructura nueva solo para mostrar un queso.
 *
 * Cada fila del mapa es una fila de píxeles; cada carácter es una clave de
 * `PALETA`. El punto (`.`) es transparente. Las claves deben coincidir con
 * `SPRITES_PRODUCTO` de @antigravity/shared, que es lo que valida el servidor.
 */
import type { SpriteProducto } from '@antigravity/shared';

/**
 * Paleta compartida por todos los sprites. Las claves son de un solo carácter
 * porque son índices dentro de los mapas de abajo — mayúscula y minúscula son
 * colores distintos (normalmente base y sombra del mismo material).
 */
const PALETA: Record<string, string> = {
  K: '#141414', // contorno negro, común a todos

  // Queso
  L: '#FFE9A8',
  Y: '#F1B82D',
  D: '#C4901B',

  // Huevos — huevo rojo sobre bandeja de pulpa gris
  H: '#DE9C66',
  E: '#C4793F',
  e: '#9E5C2C',
  T: '#9C938A',

  // Suero / lácteos claros
  S: '#EDE6D3',
  s: '#CFC4A6',
  W: '#FFFFFF',

  // Mantequilla
  M: '#FFDF7A',
  m: '#E0B94C',

  // Arepa
  A: '#E8D5A8',
  a: '#C08E4E',

  // Botella
  B: '#6FA3C4',
  b: '#4A7B99',

  // Bolsa / costal
  G: '#C9A87C',
  g: '#A8875C',

  // Deditos de yuca fritos
  J: '#F0C070',
  j: '#D9A04A',
  r: '#A8722E',

  // Caja genérica
  C: '#D4B68C',
  c: '#BF9E71',
  t: '#8A6D45',
};

type MapaSprite = readonly string[];

const MAPAS: Record<SpriteProducto, MapaSprite> = {
  queso: [
    '................',
    '................',
    '.........KKKKKK.',
    '.......KKLLLLLK.',
    '.....KKLLLLLLLK.',
    '...KKLLLLLLLLLK.',
    '..KLLLLLLLLLLLK.',
    '..KYYYYYYYYYYYK.',
    '..KYDYYYYYYDYYK.',
    '..KYYYYYDYYYYYK.',
    '..KYYYYYYYYYYYK.',
    '..KYDYYYYYYYDYK.',
    '..KYYYYYYYYYYYK.',
    '..KKKKKKKKKKKKK.',
    '................',
    '................',
  ],
  huevos: [
    '................',
    '................',
    '..KKKKKKKKKKKK..',
    '..KTTTTTTTTTTK..',
    '..KTHETHETHETK..',
    '..KTEeTEeTEeTK..',
    '..KTTTTTTTTTTK..',
    '..KTHETHETHETK..',
    '..KTEeTEeTEeTK..',
    '..KTTTTTTTTTTK..',
    '..KTHETHETHETK..',
    '..KTEeTEeTEeTK..',
    '..KTTTTTTTTTTK..',
    '..KKKKKKKKKKKK..',
    '................',
    '................',
  ],
  huevos_media: [
    '................',
    '................',
    '................',
    '..KKKKKKKKKKKK..',
    '..KTTTTTTTTTTK..',
    '..KTHETHETHETK..',
    '..KTEeTEeTEeTK..',
    '..KTTTTTTTTTTK..',
    '..KTHETHETHETK..',
    '..KTEeTEeTEeTK..',
    '..KTTTTTTTTTTK..',
    '..KKKKKKKKKKKK..',
    '................',
    '................',
    '................',
    '................',
  ],
  deditos: [
    '................',
    '.KKKK.KKKK......',
    '.KJJK.KJJK.KKKK.',
    '.KjjK.KjjK.KJJK.',
    '.KjjK.KjjK.KjjK.',
    '.KjjK.KjjK.KjjK.',
    '.KjrK.KjjK.KjjK.',
    '.KjjK.KjrK.KjjK.',
    '.KjjK.KjjK.KjjK.',
    '.KjjK.KjjK.KjrK.',
    '.KrrK.KjjK.KjjK.',
    '.KKKK.KrrK.KjjK.',
    '......KKKK.KrrK.',
    '...........KKKK.',
    '................',
    '................',
  ],
  suero: [
    '................',
    '.....KKKKKK.....',
    '.....KWWWWK.....',
    '.....KWWWWK.....',
    '....KKKKKKKK....',
    '....KSSSSSSK....',
    '...KKSSSSSSKK...',
    '...KSSSSSSSSK...',
    '...KSSSSSSSSK...',
    '...KSWWWWWWSK...',
    '...KSWssssWSK...',
    '...KSWWWWWWSK...',
    '...KSSSSSSSSK...',
    '...KSSSSSSSSK...',
    '...KKKKKKKKKK...',
    '................',
  ],
  mantequilla: [
    '................',
    '................',
    '..KKKKKKKKKKKK..',
    '..KWWWWWWWWWWK..',
    '..KKKKKKKKKKKK..',
    '..KMMMMMMMMMMK..',
    '..KMMMMMMMMMMK..',
    '..KMKKKKKKKKMK..',
    '..KMKmmmmmmKMK..',
    '..KMKmmmmmmKMK..',
    '..KMKKKKKKKKMK..',
    '..KMMMMMMMMMMK..',
    '..KMMMMMMMMMMK..',
    '..KKKKKKKKKKKK..',
    '................',
    '................',
  ],
  arepa: [
    '................',
    '................',
    '.....KKKKKK.....',
    '...KKAAAAAAKK...',
    '..KAAAAAAAAAAK..',
    '..KAAaAAAAaAAK..',
    '.KAAAAAAAAAAAAK.',
    '.KAAAAAaAAAAAAK.',
    '.KAAAAAAAAAAAAK.',
    '.KAAaAAAAAAaAAK.',
    '..KAAAAAAAAAAK..',
    '..KAAAAaAAAAAK..',
    '...KKAAAAAAKK...',
    '.....KKKKKK.....',
    '................',
    '................',
  ],
  botella: [
    '................',
    '.......KK.......',
    '.......KK.......',
    '......KWWK......',
    '......KWWK......',
    '.....KKKKKK.....',
    '....KBBBBBBK....',
    '...KBBBBBBBBK...',
    '...KBBBBBBBBK...',
    '...KBWWWWWWBK...',
    '...KBWbbbbWBK...',
    '...KBWWWWWWBK...',
    '...KBBBBBBBBK...',
    '...KBBBBBBBBK...',
    '...KKKKKKKKKK...',
    '................',
  ],
  bolsa: [
    '................',
    '.......KK.......',
    '......KWWK......',
    '.....KKWWKK.....',
    '....KWWWWWWK....',
    '...KGGGGGGGGK...',
    '..KGGGGGGGGGGK..',
    '..KGGGGGGGGGGK..',
    '..KGGggggggGGK..',
    '..KGGggggggGGK..',
    '..KGGGGGGGGGGK..',
    '..KGGGGGGGGGGK..',
    '..KGGGGGGGGGGK..',
    '..KKKKKKKKKKKK..',
    '................',
    '................',
  ],
  caja: [
    '................',
    '................',
    '..KKKKKKKKKKKK..',
    '..KCCCCCCCCCCK..',
    '..KCCCCCCCCCCK..',
    '..KKKKKKKKKKKK..',
    '..KcccKKKKcccK..',
    '..KcccKttKcccK..',
    '..KcccKttKcccK..',
    '..KcccKKKKcccK..',
    '..KccccccccccK..',
    '..KccccccccccK..',
    '..KccccccccccK..',
    '..KKKKKKKKKKKK..',
    '................',
    '................',
  ],
};

/** Un rectángulo ya comprimido: píxeles contiguos del mismo color en una fila. */
export interface TramoSprite {
  x: number;
  y: number;
  ancho: number;
  color: string;
}

/**
 * Convierte el mapa de texto en tramos horizontales (run-length encoding).
 *
 * Sin esto, un sprite serían hasta 256 `<rect>` y la Vitrina puede dibujar
 * decenas de sprites a la vez. Comprimiendo cada corrida de color a un solo
 * rectángulo, un sprite típico baja a ~40 nodos.
 */
function comprimir(mapa: MapaSprite): TramoSprite[] {
  const tramos: TramoSprite[] = [];
  mapa.forEach((fila, y) => {
    let x = 0;
    while (x < fila.length) {
      const clave = fila[x]!;
      if (clave === '.') {
        x += 1;
        continue;
      }
      let ancho = 1;
      while (x + ancho < fila.length && fila[x + ancho] === clave) ancho += 1;
      const color = PALETA[clave];
      if (color) tramos.push({ x, y, ancho, color });
      x += ancho;
    }
  });
  return tramos;
}

/** Cache: los mapas son constantes, así que cada sprite se comprime una sola vez. */
const CACHE = new Map<SpriteProducto, TramoSprite[]>();

export function tramosDe(sprite: SpriteProducto): TramoSprite[] {
  const cacheado = CACHE.get(sprite);
  if (cacheado) return cacheado;
  const tramos = comprimir(MAPAS[sprite]);
  CACHE.set(sprite, tramos);
  return tramos;
}

/** Sprite usado cuando el producto no tiene ilustración asignada. */
export const SPRITE_POR_DEFECTO: SpriteProducto = 'caja';

/** Etiquetas legibles para el selector visual del formulario. */
export const NOMBRES_SPRITE: Record<SpriteProducto, string> = {
  queso: 'Queso',
  huevos: 'Huevos',
  huevos_media: 'Media panal',
  suero: 'Suero',
  mantequilla: 'Mantequilla',
  arepa: 'Arepa',
  deditos: 'Deditos',
  botella: 'Botella',
  bolsa: 'Bolsa',
  caja: 'Caja',
};
