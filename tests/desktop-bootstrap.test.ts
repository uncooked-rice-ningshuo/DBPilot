import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// Actual Electron renderer/CSP test. Local/Remote queries have separate tests.
it.skipIf(process.env.DBPILOT_TEST_DESKTOP !== '1')('loads the desktop editor with dynamic styles while blocking inline scripts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-desktop-bootstrap-'));
  const entry = join(dir, 'entry.mjs');
  const checkEditor = `(async () => {
    const violations = [];
    document.addEventListener('securitypolicyviolation', event => violations.push(event.effectiveDirective));
    const button = [...document.querySelectorAll('button')].find(button => button.textContent === '打开 SQL 控制台');
    if (!button) throw new Error('Workbench missing');
    button.click();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (document.querySelector('textarea[aria-label="Editor content"]')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!document.querySelector('textarea[aria-label="Editor content"]')) throw new Error('Editor missing');
    const script = document.createElement('script');
    script.textContent = 'window.__unexpectedInlineScript = true';
    document.body.append(script);
    await new Promise(resolve => setTimeout(resolve, 100));
    if (window.__unexpectedInlineScript || !violations.some(value => value.startsWith('script-src'))) throw new Error('Inline scripts allowed');
    if (violations.some(value => value.startsWith('style-src'))) throw new Error('Editor styles blocked');
    return 'DBPILOT_EDITOR_READY';
  })()`;
  writeFileSync(entry, `import { app } from 'electron';
app.setPath('userData', ${JSON.stringify(dir)});
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try { console.log(await window.webContents.executeJavaScript(${JSON.stringify(checkEditor)})); }
    catch (error) { console.log('DBPILOT_EDITOR_FAILED: ' + error.message); }
    finally { app.quit(); }
  });
});
await import(${JSON.stringify(pathToFileURL(resolve('apps/desktop/main.mjs')).href)});
`);
  const env: NodeJS.ProcessEnv = { ...process.env, DBPILOT_DESKTOP_DATA_DIR: join(dir, 'userdata') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.DEEPSEEK_API_KEY; delete env.DEEPSEEK_MODEL; delete env.DEEPSEEK_BASE_URL;
  try {
    const executable = createRequire(import.meta.url)('electron') as string;
    const output = await new Promise<string>((resolveOutput, reject) => execFile(executable, [entry], { env, timeout: 15000 }, (error, stdout) => error ? reject(error) : resolveOutput(stdout)));
    expect(output).toContain('DBPILOT_EDITOR_READY');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 20000);
