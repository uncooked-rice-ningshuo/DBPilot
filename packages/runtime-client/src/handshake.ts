export function validateRuntimeHandshake(value: unknown): { protocolVersion: 1; runtimeId: string } {
  if (!value || typeof value !== 'object') throw new Error('Runtime handshake is invalid');
  const info = value as Record<string, unknown>;
  if (info.protocolVersion !== 1) throw new Error('Runtime protocol version is unsupported');
  if (typeof info.runtimeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(info.runtimeId)) throw new Error('Runtime ID is invalid');
  return { protocolVersion: 1, runtimeId: info.runtimeId };
}
