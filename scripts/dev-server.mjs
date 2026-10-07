// The Vite development UI runs on a second loopback origin.
process.env.DBPILOT_ALLOWED_ORIGINS ??= 'http://localhost:5173,http://127.0.0.1:5173';
await import('../apps/server/src/index.ts');
