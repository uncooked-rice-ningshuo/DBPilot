export type SqlKind = 'read' | 'write' | 'schema' | 'transaction' | 'unknown';
export type SqlStep = { sql: string; kind: SqlKind; decision: 'allow' | 'ask' | 'deny' };

// A deliberately small expression subset, not a guarantee about database-defined
// overloads. Database privileges remain an independent execution boundary.
const readFunctions = new Set(`COUNT SUM AVG MIN MAX ABS ROUND CEIL CEILING FLOOR
  LOWER UPPER LENGTH CHAR_LENGTH CHARACTER_LENGTH SUBSTR SUBSTRING TRIM LTRIM RTRIM
  COALESCE NULLIF IFNULL CONCAT CONCAT_WS REPLACE CAST CONVERT EXTRACT
  DATE TIME DATETIME STRFTIME JULIANDAY UNIXEPOCH NOW CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP
  JSON_EXTRACT JSON_TYPE JSON_ARRAY_LENGTH ROW_NUMBER RANK DENSE_RANK
  GENERATE_SERIES PG_SLEEP SLEEP
  DECIMAL NUMERIC VARCHAR CHAR TIMESTAMP
  SELECT FROM WHERE IN NOT EXISTS AND OR OVER PARTITION BY FILTER AS DISTINCT`.split(/\s+/));

// Token order keeps comment markers inside quoted values/identifiers intact.
const quotedOrComment = /\$([A-Za-z_0-9]*)\$[\s\S]*?\$\1\$|'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\/\*[\s\S]*?\*\/|--[^\n]*(?:\n|$)/g;

function hasUnverifiedReadCall(sql: string): boolean {
  // Mask literal contents before looking at call sites. Escaped-string dialects
  // are not supported by our statement splitter, so refuse backslashes here.
  if (sql.includes('\\')) return true;
  const expression = sql.replace(quotedOrComment, token => token.startsWith("'") || token.startsWith('$') ? "''" : token);
  for (const match of expression.matchAll(/([^\s(),+\-*/%=<>!|&]+)\s*\(/g)) {
    const name = match[1].toUpperCase();
    if (!readFunctions.has(name)) return true;
    // Whitespace may separate a schema qualifier from the function identifier.
    if (/\.\s*$/.test(expression.slice(0, match.index))) return true;
  }
  return false;
}

// Splits only at top-level semicolons. Comments, quoted values and PostgreSQL dollar strings
// do not terminate a statement. Unsupported syntax is denied by classify().
export function splitSql(input: string): string[] {
  const parts: string[] = [];
  let start = 0, i = 0, state: 'normal' | 'single' | 'double' | 'backtick' | 'line' | 'block' | 'dollar' = 'normal';
  let dollar = '';
  while (i < input.length) {
    const c = input[i], next = input[i + 1];
    if (state === 'normal') {
      if (c === "'") state = 'single';
      else if (c === '"') state = 'double';
      else if (c === '`') state = 'backtick';
      else if (c === '-' && next === '-') { state = 'line'; i++; }
      else if (c === '/' && next === '*') { state = 'block'; i++; }
      else if (c === '$') { const match = input.slice(i).match(/^\$[A-Za-z_0-9]*\$/); if (match) { dollar = match[0]; state = 'dollar'; i += dollar.length - 1; } }
      else if (c === ';') { const part = input.slice(start, i).trim(); if (part) parts.push(part); start = i + 1; }
    } else if (state === 'single' && c === "'") { if (next === "'") i++; else state = 'normal'; }
    else if (state === 'double' && c === '"') { if (next === '"') i++; else state = 'normal'; }
    else if (state === 'backtick' && c === '`') { if (next === '`') i++; else state = 'normal'; }
    else if (state === 'line' && c === '\n') state = 'normal';
    else if (state === 'block' && c === '*' && next === '/') { state = 'normal'; i++; }
    else if (state === 'dollar' && input.startsWith(dollar, i)) { i += dollar.length - 1; state = 'normal'; }
    i++;
  }
  if (!['normal', 'line'].includes(state)) throw new Error('SQL contains an unclosed quote or comment');
  const last = input.slice(start).trim(); if (last) parts.push(last);
  return parts;
}

export function classify(sql: string): SqlKind {
  // This intentionally conservative subset rejects executable/nested comments.
  // Never erase executable MySQL comments as if they were ordinary whitespace.
  if (/\/\*(?:!|M!)/i.test(sql) || /\/\*(?:(?!\*\/)[\s\S])*\/\*/.test(sql) || /--\S/.test(sql) || sql.includes('\\')) return 'unknown';
  const cleaned = sql.replace(quotedOrComment, token => token.startsWith('/*') || token.startsWith('--') ? ' ' : token).trim();
  const verb = cleaned.match(/^([A-Za-z]+)/)?.[1]?.toUpperCase();
  // WITH, EXPLAIN, procedural blocks and administrative operations require a real dialect parser.
  const readRisk = /\b(?:INTO|FOR\s+UPDATE|LOCK\s+IN\s+SHARE|LOAD_FILE|PG_READ_FILE|DBLINK|NEXTVAL)\b/i;
  if (verb === 'SELECT' && !readRisk.test(cleaned) && !readRisk.test(sql) && !hasUnverifiedReadCall(cleaned)) return 'read';
  if (['INSERT', 'UPDATE', 'DELETE'].includes(verb ?? '')) return 'write';
  // Database/user/server management, extensions, virtual/foreign objects and
  // CREATE-AS queries are outside the verified table/index DDL surface.
  if (/^(?:CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX))\b/i.test(cleaned)
    && !/\b(?:FUNCTION|PROCEDURE|TRIGGER|EVENT|SELECT|AS)\b/i.test(cleaned)) return 'schema';
  if (/^(?:BEGIN(?:\s+TRANSACTION)?|COMMIT(?:\s+TRANSACTION)?|ROLLBACK(?:\s+TRANSACTION)?)$/i.test(cleaned)) return 'transaction';
  return 'unknown';
}

export function prepareSql(sql: string, engine?: 'sqlite' | 'postgres' | 'mysql'): SqlStep[] {
  const statements = splitSql(sql);
  if (!statements.length) throw new Error('SQL is empty');
  const steps: SqlStep[] = statements.map(statement => {
    const kind = classify(statement);
    return { sql: statement, kind, decision: kind === 'unknown' ? 'deny' : kind === 'read' ? 'allow' : 'ask' };
  });
  if (steps.some(step => step.kind === 'transaction')) {
    const opening = /^(?:BEGIN(?:\s+TRANSACTION)?)$/i.test(steps[0].sql.trim());
    const closing = /^(?:COMMIT|ROLLBACK)(?:\s+TRANSACTION)?$/i.test(steps.at(-1)!.sql.trim());
    if (!['sqlite', 'postgres', 'mysql'].includes(engine ?? '') || !opening || !closing || steps.length < 2 || steps.slice(1, -1).some(step => step.kind === 'transaction') || (engine === 'mysql' && steps.slice(1, -1).some(step => step.kind === 'schema'))) {
      return steps.map(step => ({ ...step, decision: 'deny' }));
    }
  }
  return steps;
}
