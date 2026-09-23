/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // `@antigravity/shared` se resuelve al SOURCE (ver `paths` en
    // tsconfig.json), y ese source usa especificadores ESM con extensión
    // —`export * from './types/index.js'`— que en TypeScript apuntan a
    // archivos `.ts`. Webpack los toma literalmente y no encuentra el `.js`.
    //
    // Mientras la web solo importaba TIPOS de shared el problema no existía:
    // `import type` se borra en compilación y nunca se resuelve. Al importar
    // valores reales (UNIDADES_COMUNES, SPRITES_PRODUCTO) la resolución pasa
    // a ser de verdad y hay que enseñarle a webpack la equivalencia.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
