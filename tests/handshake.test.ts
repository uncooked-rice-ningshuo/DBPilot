import { describe, expect, it } from 'vitest';
import { validateRuntimeHandshake } from '../packages/runtime-client/src/handshake.js';

describe('runtime handshake', () => {
  it('requires the supported protocol and a runtime ID', () => {
    expect(validateRuntimeHandshake({ protocolVersion: 1, runtimeId: '11111111-1111-4111-8111-111111111111' })).toEqual({ protocolVersion: 1, runtimeId: '11111111-1111-4111-8111-111111111111' });
    expect(() => validateRuntimeHandshake({ protocolVersion: 2, runtimeId: '11111111-1111-4111-8111-111111111111' })).toThrow();
    expect(() => validateRuntimeHandshake({ protocolVersion: 1, runtimeId: 'server' })).toThrow();
  });
});
