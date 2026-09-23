/**
 * Selector visual de ilustración. Una rejilla de sprites en la que se toca el
 * que corresponde — más rápido y menos ambiguo que un desplegable con nombres,
 * que es justo la fricción que este cambio busca quitar del alta de productos.
 */
import { SPRITES_PRODUCTO } from '@antigravity/shared';

import { NOMBRES_SPRITE } from './pixelSprites';
import { ProductSprite } from './ProductSprite';

import type { SpriteProducto } from '@antigravity/shared';

interface SpritePickerProps {
  valor: SpriteProducto | null;
  onChange: (sprite: SpriteProducto | null) => void;
}

export function SpritePicker({ valor, onChange }: SpritePickerProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SPRITES_PRODUCTO.map((sprite) => {
        const activo = valor === sprite;
        return (
          <button
            key={sprite}
            type="button"
            aria-pressed={activo}
            title={NOMBRES_SPRITE[sprite]}
            // Volver a tocar el sprite activo lo deselecciona: sin esto no
            // habría forma de dejar un producto sin ilustración una vez
            // elegida una.
            onClick={() => onChange(activo ? null : sprite)}
            className={`border-2 p-1 transition-colors ${
              activo ? 'border-black bg-brand-blue/20' : 'border-neutral-300 hover:border-black bg-white'
            }`}
          >
            <ProductSprite sprite={sprite} size={30} />
          </button>
        );
      })}
    </div>
  );
}
