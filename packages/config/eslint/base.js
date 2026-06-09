// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Config base de ESLint (flat config) para paquetes Node/TS del monorepo
 * (apps/api, packages/*, scripts). apps/web usa `eslint-config-next` —
 * forzar un preset único entre Next.js y Node el día 1 da más fricción de
 * plugins que beneficio real (ver plan de bootstrap).
 */
export const baseConfig = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
    },
  },
  {
    ignores: ['dist/**', 'generated/**', 'node_modules/**', '.turbo/**'],
  },
)

export default baseConfig
