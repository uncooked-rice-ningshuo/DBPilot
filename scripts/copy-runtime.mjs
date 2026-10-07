import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist/server/apps/server/src', { recursive: true });
copyFileSync('apps/server/src/sqlite-worker.mjs', 'dist/server/apps/server/src/sqlite-worker.mjs');
copyFileSync('apps/server/src/sqlite-parent-watch.mjs', 'dist/server/apps/server/src/sqlite-parent-watch.mjs');

mkdirSync('dist/server/packages/storage/src', { recursive: true });
copyFileSync('packages/storage/src/native-database.mjs', 'dist/server/packages/storage/src/native-database.mjs');
