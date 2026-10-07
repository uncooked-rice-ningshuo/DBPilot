import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: 'apps/web', plugins: [react(), tailwindcss()], resolve: { alias: { '@ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)) } }, server: { proxy: { '/api': 'http://127.0.0.1:3000' } }, build: { outDir: '../../dist/web', emptyOutDir: true } });
