// Loss of the acknowledgement channel cannot prove whether a write committed.
export function isUncertainDatabaseFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; fatal?: unknown; message?: unknown };
  const code = typeof value.code === 'string' ? value.code : '';
  return value.fatal === true || code.startsWith('08') || [
    '57P01', '57P02', '57P03', 'ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ETIMEDOUT',
    'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR', 'PROTOCOL_SEQUENCE_TIMEOUT'
  ].includes(code) || (typeof value.message === 'string' && /connection (?:terminated|closed)|query read timeout/i.test(value.message));
}
export class UnknownWriteOutcome extends Error {
  constructor() { super('Database connection was lost; write outcome is unknown'); }
}
