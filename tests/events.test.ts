import { describe, expect, it } from 'vitest';
import { ExecutionEvents } from '../packages/core/src/events.js';

describe('execution event history', () => {
  it('replays only later events and detects a bounded-history gap', () => {
    const hub = new ExecutionEvents(2);
    hub.publish('one', 'started');
    hub.publish('one', 'step', { index: 0 });
    hub.publish('one', 'completed');
    expect(hub.replay('one', 1)).toMatchObject({ gap: false, events: [{ seq: 2 }, { seq: 3 }] });
    expect(hub.replay('one', 0)?.gap).toBe(true);
  });
  it('notifies a subscriber until it unsubscribes', () => {
    const hub = new ExecutionEvents();
    hub.publish('one', 'started');
    const seen: number[] = [];
    const unsubscribe = hub.subscribe('one', event => seen.push(event.seq));
    hub.publish('one', 'step');
    unsubscribe();
    hub.publish('one', 'completed');
    expect(seen).toEqual([2]);
  });
});
