import { describe, expect, it } from 'vitest';
import { connectionFailure } from '../apps/server/src/connection-errors.js';

const mysqlProfile = {
  engine: 'mysql' as const,
  name: 'test',
  host: '172.18.0.7',
  port: 3306,
  database: 'sample',
  user: 'root',
  password: 'do-not-echo',
  ssl: false,
};

describe('connection failure messages', () => {
  it.each([
    ['ETIMEDOUT', '容器内网地址'],
    ['ENETUNREACH', '容器内网地址'],
    ['ECONNREFUSED', '端口拒绝连接'],
    ['ENOTFOUND', '主机名无法解析'],
    ['ER_ACCESS_DENIED_ERROR', '数据库拒绝登录'],
    ['ER_BAD_DB_ERROR', '数据库名称不存在'],
    ['HANDSHAKE_SSL_ERROR', 'TLS 握手'],
  ])('explains %s without exposing connection data', (code, expected) => {
    const message = connectionFailure(mysqlProfile, Object.assign(new Error('secret in driver error'), { code }));
    expect(message).toContain(expected);
    expect(message).not.toContain(mysqlProfile.password);
    expect(message).not.toContain(mysqlProfile.host);
    expect(message).not.toContain('secret in driver error');
  });

  it('keeps a safe fallback for unknown driver failures', () => {
    expect(connectionFailure(mysqlProfile, new Error('password=do-not-echo'))).toContain('数据库连接失败');
    expect(connectionFailure(mysqlProfile, new Error('password=do-not-echo'))).not.toContain(mysqlProfile.password);
  });
});
