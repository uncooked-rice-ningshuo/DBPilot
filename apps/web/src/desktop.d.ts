import type { DesktopOperation } from '../../../packages/runtime-client/src/desktop-operations.js';

declare global {
  interface Window {
    dbpilotDesktop?: Record<DesktopOperation, (input: unknown) => Promise<{ statusCode: number; body: unknown }>> & {
      getTarget: () => Promise<{ kind: 'local' | 'remote'; baseUrl?: string }>;
      setTarget: (target: { kind: 'local' | 'remote'; baseUrl?: string }) => Promise<{ kind: 'local' | 'remote'; baseUrl?: string }>;
      copyText: (text: string) => Promise<void>;
      pickSqliteFile: () => Promise<string | null>;
    };
  }
}
