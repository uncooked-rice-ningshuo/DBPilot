import { describe, expect, it } from 'vitest';
import { readExecutionStream } from '../packages/runtime-client/src/sse.js';

describe('SSE runtime client', () => {
  it('parses events across chunk boundaries and stops at a terminal event', async () => {
    const encoder = new TextEncoder();
    const source = 'id: 1\nevent: started\ndata: {"executionId":"one","seq":1,"type":"started","timestamp":"now","payload":{}}\n\nid: 2\nevent: completed\ndata: {"executionId":"one","seq":2,"type":"completed","timestamp":"now","payload":{}}\n\n';
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode(source.slice(0, 23))); controller.enqueue(encoder.encode(source.slice(23))); controller.close(); } });
    const seen: string[] = [];
    const completed = await readExecutionStream(new Response(stream), event => seen.push(event.type));
    expect(completed).toBe(true);
    expect(seen).toEqual(['started', 'completed']);
  });
});
