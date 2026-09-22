import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Listen on all interfaces. Vite's default binds to loopback only, which a
    // container port-forwarder (GitHub Codespaces, Docker, a remote VM) cannot
    // reach, so the browser gets ERR_CONNECTION_REFUSED.
    host: true,
    // When the dev server is reached through a forwarded hostname rather than
    // localhost, Vite's host check must be told that hostname is expected.
    allowedHosts: ['localhost', '127.0.0.1', '.app.github.dev', '.githubpreview.dev'],
    proxy: {
      // Proxying keeps the browser on a single origin, so the session cookie
      // and the EventSource stream work without any CORS special-casing.
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    host: true,
    allowedHosts: ['localhost', '127.0.0.1', '.app.github.dev', '.githubpreview.dev'],
  },
  build: { outDir: 'dist', sourcemap: true },
});
