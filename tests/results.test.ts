import { describe, expect, it } from 'vitest';
import { boundedRows, ResultAccumulator } from '../packages/core/src/results.js';

describe('bounded result snapshots', () => {
  it('stops before exceeding row and byte limits', () => {
    expect(boundedRows([[1], [2], [3]], value => value, 2, 100)).toMatchObject({ rows: [[1], [2]], truncated: true });
    expect(boundedRows([['a'], ['very-long']], value => value, 10, 10)).toMatchObject({ rows: [['a']], truncated: true });
  });
  it('bounds incremental driver rows without retaining later values', () => {
    const accumulator = new ResultAccumulator(value => value, 2, 100);
    accumulator.push([1]); accumulator.push([2]); accumulator.push([3]);
    expect(accumulator.rows).toEqual([[1], [2]]);
    expect(accumulator.truncated).toBe(true);
    const byteLimited = new ResultAccumulator(value => value, 10, 6);
    byteLimited.push(['a']); byteLimited.push(['long']);
    expect(byteLimited.rows).toEqual([['a']]);
    expect(byteLimited.truncated).toBe(true);
  });
});
