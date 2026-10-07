export class ModelFailure extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ModelFailure'; }
}
export function modelHttpFailure(status: number): ModelFailure {
  if ([401,403].includes(status)) return new ModelFailure('MODEL_AUTH', '模型认证失败，请检查 API Key 和模型权限。');
  if (status===429) return new ModelFailure('MODEL_RATE_LIMIT', '模型接口限流或额度不足，请检查供应商额度后重试。');
  if (status===404) return new ModelFailure('MODEL_NOT_FOUND', '模型或接口地址不存在，请核对 API 地址与模型 ID。');
  return new ModelFailure('MODEL_HTTP', `模型接口返回 HTTP ${status}，请检查服务状态。`);
}
