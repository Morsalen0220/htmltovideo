#!/usr/bin/env node
/**
 * Quick launch script - runs Vite dev server then starts Electron
 * Alternative to the full npm run dev command
 */
const { spawn } = require('child_process');
const { createServer } = require('vite');

async function main() {
  console.log('[H2V] Starting Vite dev server...');
  
  // Start Vite
  const viteProc = spawn('npx', ['vite'], {
    stdio: 'inherit',
    shell: true,
    cwd: __dirname
  });

  // Wait for Vite to be ready
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('[H2V] Starting Electron...');
  
  // Compile electron TS and start
  const tscProc = spawn('npx', ['tsc', '-p', 'tsconfig.electron.json'], {
    stdio: 'inherit',
    shell: true,
    cwd: __dirname
  });

  tscProc.on('close', (code) => {
    if (code !== 0) {
      console.error('[H2V] TypeScript compilation failed');
      process.exit(1);
    }
    
    const electronProc = spawn('npx', ['electron', '.'], {
      stdio: 'inherit',
      shell: true,
      cwd: __dirname,
      env: { ...process.env, NODE_ENV: 'development', VITE_DEV_SERVER_URL: 'http://localhost:5173' }
    });

    electronProc.on('close', () => {
      viteProc.kill();
      process.exit(0);
    });
  });
}

main().catch(console.error);
