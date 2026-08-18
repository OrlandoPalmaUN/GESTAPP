import { baseConfig } from '@antigravity/config/eslint/base.js'

export default [
  ...baseConfig,
  {
    // Tests y scripts de apoyo: las respuestas de la API se inspeccionan como
    // JSON suelto a propósito. Tiparlas obligaría a duplicar acá cada forma de
    // respuesta, y esa duplicación haría que el test valide contra el tipo que
    // yo escribí en vez de contra lo que la API realmente devuelve — que es
    // justo lo que se quiere comprobar.
    files: ['src/test/**/*.ts', 'src/scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
]
