import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main process entry — vite-plugin-electron starts Electron here
        entry: 'electron/main.ts',
        onstart(options) {
          // Start Electron with the dev server URL injected as env var
          options.startup(['.'], {
            env: {
              ...process.env,
              NODE_ENV: 'development',
              VITE_DEV_SERVER_URL: 'http://localhost:5173'
            }
          });
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'electron/main.ts',
              formats: ['cjs']
            },
            rollupOptions: {
              external: [
                'electron',
                'puppeteer-core',
                'ffmpeg-static',
                'fluent-ffmpeg',
                'acorn',
                'acorn-walk',
                'fs',
                'path',
                'os',
                'child_process',
                'crypto',
                'http',
                'https',
                'stream',
                'util',
                'events',
                'net',
                'url',
                'zlib',
                'assert',
                'buffer'
              ],
              output: {
                entryFileNames: 'main.js'
              }
            },
            minify: false
          }
        }
      },
      {
        // IPC render handlers (required by main.js at runtime)
        entry: 'electron/ipc.ts',
        onstart(options) {
          // Don't start a new Electron window — just reload the existing one
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'electron/ipc.ts',
              formats: ['cjs']
            },
            rollupOptions: {
              external: [
                'electron',
                'puppeteer-core',
                'ffmpeg-static',
                'fluent-ffmpeg',
                'fs',
                'path',
                'os',
                'child_process',
                'crypto',
                'http',
                'https',
                'stream',
                'util',
                'events',
                'net',
                'url',
                'zlib',
                'assert',
                'buffer'
              ],
              output: {
                entryFileNames: 'ipc.js'
              }
            },
            minify: false
          }
        }
      },
      {
        // Renderer engine (required by ipc.js at runtime)
        entry: 'electron/renderer.ts',
        onstart(options) {
          // Don't start a new Electron window — just reload the existing one
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'electron/renderer.ts',
              formats: ['cjs']
            },
            rollupOptions: {
              external: [
                'electron',
                'puppeteer-core',
                'ffmpeg-static',
                'fluent-ffmpeg',
                'fs',
                'path',
                'os',
                'child_process',
                'crypto',
                'http',
                'https',
                'stream',
                'util',
                'events',
                'net',
                'url',
                'zlib',
                'assert',
                'buffer'
              ],
              output: {
                entryFileNames: 'renderer.js'
              }
            },
            minify: false
          }
        }
      },
      {
        // Preload script
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'electron/preload.ts',
              formats: ['cjs']
            },
            rollupOptions: {
              external: ['electron'],
              output: {
                entryFileNames: 'preload.js'
              }
            },
            minify: false
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
