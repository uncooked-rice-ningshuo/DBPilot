export type ResultPage = { columns: string[]; rows: unknown[][]; nextCursor: string | null; truncated: boolean };
export type ResultPages = Record<string, ResultPage>;
export const resultPageKey = (executionId: string, index: number) => `${executionId}:${index}`;
/** Snapshots are immutable. A repeated or late cursor must not append twice or rewind rows. */
export function mergeResultPage(previous: ResultPages, executionId: string, index: number, page: ResultPage, cursor?: string): ResultPages {
  const key = resultPageKey(executionId, index);
  const current = previous[key];
  if (!cursor) return current ? previous : { ...previous, [key]: page };
  if (!current || current.nextCursor !== cursor) return previous;
  return { ...previous, [key]: { ...page, rows: [...current.rows, ...page.rows] } };
}
