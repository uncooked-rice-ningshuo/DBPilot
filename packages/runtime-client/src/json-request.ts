import { RuntimeRequestError } from './errors.js';

export function runtimeRequestTimeoutMs(url: string): number {
  return url.split('?')[0].endsWith('/api/v1/ai/test') ? 70_000 : 35_000;
}
/** Covers headers and body; never retries a mutation or any other request. */
export async function requestRuntimeJson(url: string | URL, init: RequestInit = {}, options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? runtimeRequestTimeoutMs(String(url)));
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  try {
    const response = await (options.fetchImpl ?? fetch)(url, { ...init, signal, redirect: 'error' });
    if (response.status === 204) return { statusCode: 204, body: null };
    let body: unknown;
    try { body = await response.json(); }
    catch (error) {
      if (signal.aborted) throw error;
      if (response.ok) throw new RuntimeRequestError('Runtime 返回的数据不完整或格式无效，请刷新状态后核对。', response.status, 'RUNTIME_PROTOCOL');
      body = null;
    }
    return { statusCode: response.status, body };
  } catch (error) {
    if (controller.signal.aborted && !init.signal?.aborted) throw new RuntimeRequestError('Runtime 请求超时。操作可能已经完成，请先刷新状态或查看历史，避免重复执行。', 0, 'RUNTIME_TIMEOUT');
    throw error;
  } finally { clearTimeout(timer); }
}
