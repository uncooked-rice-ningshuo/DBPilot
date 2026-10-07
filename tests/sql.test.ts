import { describe, expect, it } from 'vitest';
import { classify, prepareSql, splitSql } from '../packages/core/src/sql.js';

describe('SQL preparation', () => {
  it.each([
    'CREATE USER someone', 'ALTER SYSTEM SET shared_preload_libraries = something',
    'CREATE EXTENSION something', 'DROP DATABASE target', 'DROP ROLE someone',
    'CREATE VIRTUAL TABLE files USING filesystem', 'CREATE FOREIGN TABLE remote(id INT) SERVER elsewhere',
    'CREATE TABLE copied AS SELECT custom_mutation()',
  ])('denies administrative or unverified DDL: %s', sql => {
    expect(classify(sql)).toBe('unknown');
  });
  it.each(['CREATE TABLE items(id INT)', 'CREATE UNIQUE INDEX idx ON items(id)', 'ALTER TABLE items ADD COLUMN name TEXT', 'DROP TABLE items', 'DROP INDEX idx'])('retains the supported table/index DDL subset: %s', sql => {
    expect(classify(sql)).toBe('schema');
  });
  it.each([
    "SELECT setval('seq', 1)", "SELECT pg_advisory_lock(1)",
    "SELECT load_extension('extension')", "SELECT writefile('/tmp/a', 'b')",
    "SELECT GET_LOCK('name', 1)", 'SELECT custom_mutation()',
    'SELECT public.count(*)', 'SELECT "count"(*)', 'SELECT `count`(*)',
    'SELECT custom_mutation/**/()',
    "SELECT '/*', custom_mutation(), '*/'",
    'SELECT 1--2+custom_mutation()',
    'SELECT public . count(*)',
  ])('rejects unverified SELECT function calls: %s', sql => {
    expect(classify(sql)).toBe('unknown');
  });
  it.each([
    'SELECT count(*), max(id), coalesce(name, \'unknown\') FROM items',
    'SELECT (1 + 2) WHERE 1 IN (1, 2)',
    'SELECT CAST(1 AS DECIMAL(29,9))',
    "SELECT 'custom_mutation()' AS text", 'SELECT pg_sleep(1)',
  ])('keeps the supported read expression subset: %s', sql => {
    expect(classify(sql)).toBe('read');
  });
  it.each([
    'SELECT * FROM items FOR/**/UPDATE',
    'SELECT * FROM items LOCK/* gap */IN SHARE MODE',
    'SELECT 1 /*!50000 INTO OUTFILE \'/tmp/output\' */',
    'SELECT 1 /*M! INTO OUTFILE \'/tmp/output\' */',
    'SELECT /*!50000 SQL_NO_CACHE */ 1',
    'SELECT /*M! SQL_NO_CACHE */ 1',
    'SELECT 1 /* outer /* nested */ still nested */',
    'SELECT 1 # MySQL comment\n INTO OUTFILE \'/tmp/output\'',
  ])('denies risk syntax hidden by comments: %s', sql => {
    expect(prepareSql(sql, 'mysql').some(step => step.decision === 'deny')).toBe(true);
  });
  it('does not split inside strings or comments', () => {
    expect(splitSql("SELECT ';' AS value; -- ;\nSELECT 2;")).toHaveLength(2);
    expect(splitSql('SELECT $$a;b$$; SELECT 2')).toHaveLength(2);
  });
  it('denies unknown and ambiguous operations', () => {
    expect(classify('WITH changed AS (DELETE FROM users RETURNING *) SELECT * FROM changed')).toBe('unknown');
    expect(classify('EXPLAIN ANALYZE DELETE FROM users')).toBe('unknown');
    expect(prepareSql('SELECT 1; VACUUM;')[1].decision).toBe('deny');
  });
  it('classifies supported statements individually', () => {
    expect(prepareSql('SELECT 1; DELETE FROM users WHERE id = 1')).toMatchObject([
      { kind: 'read', decision: 'allow' }, { kind: 'write', decision: 'ask' }
    ]);
  });
  it('rejects unclosed SQL', () => {
    expect(() => splitSql("SELECT 'oops")).toThrow();
  });
  it('allows only a complete SQLite transaction block', () => {
    expect(prepareSql('BEGIN; INSERT INTO items VALUES (1); COMMIT', 'sqlite').map(step => step.decision)).toEqual(['ask', 'ask', 'ask']);
    expect(prepareSql('BEGIN; SELECT 1', 'sqlite').every(step => step.decision === 'deny')).toBe(true);
    expect(prepareSql('BEGIN; SELECT 1; COMMIT', 'postgres').map(step => step.decision)).toEqual(['ask', 'allow', 'ask']);
    expect(prepareSql('BEGIN; SELECT 1; COMMIT', 'mysql').map(step => step.decision)).toEqual(['ask', 'allow', 'ask']);
    expect(prepareSql('BEGIN; CREATE TABLE x(id INT); COMMIT', 'mysql').every(step => step.decision === 'deny')).toBe(true);
  });
});
