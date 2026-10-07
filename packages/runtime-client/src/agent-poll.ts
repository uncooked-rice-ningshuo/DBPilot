/** Read-only polling. No request creation, approval or execution is ever retried here. */
export function pollAgent<T extends { status: string }>(options: {
  read: () => Promise<T>;
  onSnapshot: (snapshot: T) => void;
  onUnavailable: (error: unknown, retrying: boolean) => void;
  intervalMs?: number;
  maxFailures?: number;
}) {
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = (delay: number) => { timer = setTimeout(() => { void tick(); }, delay); };
  async function tick() {
    try {
      const snapshot = await options.read();
      if (stopped) return;
      failures = 0;
      options.onSnapshot(snapshot);
      if (['running', 'awaiting_approval', 'cancelling'].includes(snapshot.status)) schedule(options.intervalMs ?? 700);
    } catch (error) {
      if (stopped) return;
      failures++;
      const status = (error as { status?: number })?.status;
      const retrying = ![401, 403, 404, 410].includes(status ?? 0) && failures < (options.maxFailures ?? 5);
      options.onUnavailable(error, retrying);
      if (retrying) schedule(Math.min(8000, (options.intervalMs ?? 700) * 2 ** failures));
    }
  }
  schedule(0);
  return () => { stopped = true; clearTimeout(timer); };
}
