export class RuntimeRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = 'RuntimeRequestError'; }
}
export function requestError(status: number, body: unknown): RuntimeRequestError {
  const payload = body && typeof body === 'object' ? body as { error?: unknown; code?: unknown } : {};
  if (status === 404 && payload.error === 'Not Found')
    return new RuntimeRequestError('当前页面与后端版本不一致，请重启 DBPilot 服务后刷新页面。', status);
  return new RuntimeRequestError(typeof payload.error === 'string' ? payload.error : `请求失败（HTTP ${status}）`, status, typeof payload.code === 'string' ? payload.code : undefined);
}
