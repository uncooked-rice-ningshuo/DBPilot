export type ExecutionEvent = { executionId: string; seq: number; type: 'started' | 'step' | 'completed' | 'failed' | 'cancelled' | 'outcome_unknown'; timestamp: string; payload: Record<string, unknown> };
type Stream = { events: ExecutionEvent[]; listeners: Set<(event: ExecutionEvent) => void>; nextSeq: number };

export class ExecutionEvents {
  private readonly streams = new Map<string, Stream>();
  constructor(private readonly maxEvents = 100) {}

  publish(executionId: string, type: ExecutionEvent['type'], payload: Record<string, unknown> = {}): ExecutionEvent {
    const stream = this.streams.get(executionId) ?? { events: [], listeners: new Set(), nextSeq: 1 };
    this.streams.set(executionId, stream);
    const event = { executionId, seq: stream.nextSeq++, type, timestamp: new Date().toISOString(), payload };
    stream.events.push(event);
    if (stream.events.length > this.maxEvents) stream.events.shift();
    for (const listener of stream.listeners) listener(event);
    return event;
  }

  replay(executionId: string, afterSeq: number): { events: ExecutionEvent[]; gap: boolean } | undefined {
    const stream = this.streams.get(executionId);
    if (!stream) return undefined;
    return { events: stream.events.filter(event => event.seq > afterSeq), gap: afterSeq < stream.events[0].seq - 1 };
  }

  subscribe(executionId: string, listener: (event: ExecutionEvent) => void): () => void {
    const stream = this.streams.get(executionId);
    if (!stream) throw new Error('Unknown execution');
    stream.listeners.add(listener);
    return () => stream.listeners.delete(listener);
  }

  delete(executionId: string) { this.streams.delete(executionId); }
}
