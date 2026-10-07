export const RESULT_ROW_LIMIT = 10_000;
export const RESULT_BYTE_LIMIT = 20 * 1024 * 1024;

export class ResultAccumulator {
  readonly rows: unknown[][] = [];
  bytes = 0;
  truncated = false;
  constructor(private readonly serialize: (value: unknown) => unknown, private readonly maxRows = RESULT_ROW_LIMIT, private readonly maxBytes = RESULT_BYTE_LIMIT) {}
  push(sourceRow: unknown[]) {
    if (this.truncated) return;
    if (this.rows.length >= this.maxRows) { this.truncated = true; return; }
    const row = sourceRow.map(this.serialize);
    const rowBytes = Buffer.byteLength(JSON.stringify(row));
    if (this.bytes + rowBytes > this.maxBytes) { this.truncated = true; return; }
    this.rows.push(row); this.bytes += rowBytes;
  }
}

export function boundedRows(source: Iterable<unknown[]>, serialize: (value: unknown) => unknown, maxRows = RESULT_ROW_LIMIT, maxBytes = RESULT_BYTE_LIMIT) {
  const rows: unknown[][] = [];
  let bytes = 0;
  let truncated = false;
  for (const sourceRow of source) {
    if (rows.length >= maxRows) { truncated = true; break; }
    const row = sourceRow.map(serialize);
    const rowBytes = Buffer.byteLength(JSON.stringify(row));
    if (bytes + rowBytes > maxBytes) { truncated = true; break; }
    rows.push(row); bytes += rowBytes;
  }
  return { rows, truncated, bytes };
}
