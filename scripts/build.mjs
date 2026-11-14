import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
await build({ entryPoints: { main: 'src/main/index.ts', preload: 'src/preload/index.ts', bridge: 'src/mcp/bridge-cli.ts' }, bundle: true, platform: 'node', format: 'cjs', outdir: 'dist', outExtension: { '.js': '.cjs' }, external: ['electron'], sourcemap: true });
await viteBuild({ root: 'src/renderer', base: './', build: { outDir: '../../dist/renderer', emptyOutDir: true } });
