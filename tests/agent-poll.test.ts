import { afterEach, expect, it, vi } from 'vitest';
import { pollAgent } from '../packages/runtime-client/src/agent-poll.js';
import { requestError } from '../packages/runtime-client/src/errors.js';
afterEach(() => vi.useRealTimers());
it('recovers transient read failures, polls approvals, and stops at terminal status', async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ status: 'awaiting_approval' }).mockResolvedValueOnce({ status: 'cancelling' }).mockResolvedValueOnce({ status: 'cancelled' });
  const onSnapshot = vi.fn(), onUnavailable = vi.fn();
  const stop = pollAgent({ read, onSnapshot, onUnavailable, intervalMs: 10 });
  await vi.runAllTimersAsync();
  expect(read).toHaveBeenCalledTimes(4);
  expect(onUnavailable).toHaveBeenCalledWith(expect.any(Error), true);
  expect(onSnapshot.mock.calls.map(([s]) => s.status)).toEqual(['awaiting_approval', 'cancelling', 'cancelled']);
  stop();
});
it('bounds retries and stops immediately on expired or missing runs', async () => {
  vi.useFakeTimers();
  for (const error of [new Error('offline'), requestError(404, { error: 'Run unavailable' }), requestError(410, {})]) {
    const read = vi.fn().mockRejectedValue(error), onUnavailable = vi.fn();
    const stop = pollAgent({ read, onSnapshot: vi.fn(), onUnavailable, maxFailures: 3, intervalMs: 10 });
    await vi.runAllTimersAsync();
    expect(read).toHaveBeenCalledTimes('status' in error ? 1 : 3);
    expect(onUnavailable).toHaveBeenLastCalledWith(error, false);
    stop();
  }
});
it('ignores late responses after switching or unmounting the conversation', async () => {
  vi.useFakeTimers();
  let resolve!: (value: {status:string}) => void;
  const onSnapshot=vi.fn();
  const stop=pollAgent({read:()=>new Promise(done=>{resolve=done;}),onSnapshot,onUnavailable:vi.fn()});
  await vi.advanceTimersByTimeAsync(0); stop(); resolve({status:'running'});
  await vi.runAllTimersAsync();
  expect(onSnapshot).not.toHaveBeenCalled();
});
