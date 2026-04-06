import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'integrations/nestjs/index': 'src/integrations/nestjs/index.ts',
    'integrations/nextjs/index': 'src/integrations/nextjs/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node18',
  splitting: true,
  external: ['@nestjs/common', '@nestjs/config', '@nestjs/core', 'next'],
})
