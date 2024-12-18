import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['soaper-dl.ts'],
  format: ['esm'],
  clean: true,
  minify: true,
  platform: "node",
  target: 'esnext',
  module: "NodeNext",
  //Always bundle modules matching given patterns
  noExternal: ['cheerio'],
  skipNodeModulesBundle: true,
  sourcemap: true,
  tsconfig: './tsconfig.json'
})
