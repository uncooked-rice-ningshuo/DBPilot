import { describe, expect, it } from 'vitest';
import { requestError } from '../packages/runtime-client/src/errors.js';

describe('API error presentation', () => {
  it('explains missing routes from an older Runtime instead of showing Not Found', () => {
    const error = requestError(404, { error: 'Not Found', message: 'Route POST:/api/v1/connections/test not found' });
    expect(error.message).toContain('后端版本不一致');
  });
  it('keeps a specific connection failure rather than treating it as a version mismatch', () => {
    expect(requestError(404, { error: 'Connection not found' }).message).toBe('Connection not found');
    expect(requestError(502, { error: 'SQLite 文件无法打开' }).message).toBe('SQLite 文件无法打开');
  });
});

it('preserves machine-readable expiry codes without guessing from HTTP status', () => {
  expect(requestError(410, {error:'过期',code:'RESULT_EXPIRED'})).toMatchObject({status:410,code:'RESULT_EXPIRED'});
  expect(requestError(410, {error:'Agent history expired'}).code).toBeUndefined();
});
