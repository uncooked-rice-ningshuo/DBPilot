import { expect, it } from 'vitest';
import { isUncertainDatabaseFailure } from '../apps/server/src/query-failures.js';
it.each([{ code: 'ECONNRESET' }, { code: '08006' }, { code: '57P01' }, { code: 'PROTOCOL_CONNECTION_LOST' }, { fatal: true }, new Error('Connection terminated unexpectedly')])('identifies uncertain network/database loss %j', error => {
  expect(isUncertainDatabaseFailure(error)).toBe(true);
});
it.each([{ code: '23505' }, { code: '42P01' }, { code: 'ER_DUP_ENTRY' }, new Error('syntax error')])('keeps explicit statement errors as failures %j', error => {
  expect(isUncertainDatabaseFailure(error)).toBe(false);
});
