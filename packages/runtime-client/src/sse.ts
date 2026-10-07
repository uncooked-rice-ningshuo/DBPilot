export type StreamEvent = { executionId: string; seq: number; type: string; timestamp: string; payload: Record<string, unknown> };

export async function readExecutionStream(response: Response, onEvent: (event: StreamEvent) => void): Promise<boolean> {
  if (!response.ok || !response.body) throw new Error('Execution stream unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      while (buffer.includes('\n\n')) {
        const end = buffer.indexOf('\n\n');
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame.split('\n').find(line => line.startsWith('data: '));
        if (!data) continue;
        const event = JSON.parse(data.slice(6)) as StreamEvent;
        onEvent(event);
        if (['completed', 'failed', 'cancelled', 'outcome_unknown'].includes(event.type)) return true;
      }
      if (done) return false;
    }
  } finally { await reader.cancel(); }
}
