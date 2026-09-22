import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    root: resolve(__dirname, 'web'),

    resolve: {
        alias: {
            shared: resolve(__dirname, 'shared')
        }
    },

    server: {
        port: 1420,
        strictPort: true
    },

    build: {
        outDir: resolve(__dirname, 'dist'),
        emptyOutDir: true
    }
});