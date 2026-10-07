import { notify } from '@ui/notify';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@ui/components/button';
import { Input } from '@ui/components/input';
import { AppIcon } from '@ui/icons';
import { databaseCatalog, tableCatalog } from '../../protocol/src/index.js';

export type NavigationConnection = { id: string; version?: number; name: string; engine: 'sqlite' | 'postgres' | 'mysql'; database?: string; host?: string; filename?: string };
export type NavigationTable = { schema: string; name: string; columns: { name: string; type: string; nullable: boolean }[] };
type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Catalog = { name: string }[];
const rootKey = (connection: NavigationConnection) => JSON.stringify([connection.id, connection.version ?? 1]);
const databaseKey = (connection: NavigationConnection, database: string) => `${rootKey(connection)}/${JSON.stringify(database)}`;
const schemaKey = (connection: NavigationConnection, database: string, schema: string) => `${databaseKey(connection, database)}/${JSON.stringify(schema)}`;

export function ConnectionNavigator({ connections, selectedId, selectedDatabase, selectedTable, api, onSelect, onEdit, onDelete, onTest, tests }: {
  connections: NavigationConnection[]; selectedId: string; selectedDatabase?: string; selectedTable?: NavigationTable | null; api: Api;
  onSelect: (connection: NavigationConnection, database?: string, table?: NavigationTable) => void;
  onEdit: (id: string) => void; onDelete: (connection: NavigationConnection, trigger: HTMLButtonElement) => void; onTest: (id: string) => void;
  tests: Record<string, { status: string; message: string }>;
}) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchCollapsed, setSearchCollapsed] = useState<Set<string>>(new Set());
  const [catalogs, setCatalogs] = useState<Record<string, Catalog>>({});
  const [schemas, setSchemas] = useState<Record<string, NavigationTable[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [indexing, setIndexing] = useState(false);
  const cache = useRef(new Map<string, Catalog | NavigationTable[]>());
  const pending = useRef(new Map<string, Promise<Catalog | NavigationTable[]>>());
  const bulkToken = useRef(0);
  const currentRoots = useRef(new Set<string>());
  currentRoots.current = new Set(connections.map(rootKey));
  const query = search.trim().toLocaleLowerCase();
  const connectionRevision = connections.map(rootKey).join('|');
  const isOpen = (key: string) => query ? !searchCollapsed.has(key) : expanded.has(key);
  function toggle(key: string) {
    if (query) setSearchCollapsed(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    else setExpanded(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }
  async function load(connection: NavigationConnection, database?: string): Promise<Catalog | NavigationTable[]> {
    if (!currentRoots.current.has(rootKey(connection))) throw new Error('连接已更新，请重新加载');
    const key = database === undefined ? rootKey(connection) : databaseKey(connection, database);
    if (cache.current.has(key)) return cache.current.get(key)!;
    if (pending.current.has(key)) return pending.current.get(key)!;
    setLoading(current => new Set(current).add(key));
    setErrors(current => { const next = { ...current }; delete next[key]; return next; });
    const promise = (async () => {
      try {
        if (database === undefined) {
          const parsed = databaseCatalog.parse(await api(`/connections/${connection.id}/databases`));
          if (!currentRoots.current.has(rootKey(connection))) return parsed.databases;
          cache.current.set(key, parsed.databases); setCatalogs(current => ({ ...current, [key]: parsed.databases })); return parsed.databases;
        }
        const tables: NavigationTable[] = [];
        let cursor: string | undefined;
        do {
          const data = tableCatalog.parse(await api(`/connections/${connection.id}/tables?database=${encodeURIComponent(database)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`));
          if (!currentRoots.current.has(rootKey(connection))) return tables;
          tables.push(...data.tables);
          if (data.nextCursor && data.nextCursor === cursor) throw new Error('目录分页未继续前进，请重试');
          cursor = data.nextCursor;
        } while (cursor);
        cache.current.set(key, tables); setSchemas(current => ({ ...current, [key]: tables })); return tables;
      } catch (error) {
        if (currentRoots.current.has(rootKey(connection))) { setErrors(current => ({ ...current, [key]: (error as Error).message })); notify.error((error as Error).message, { id: `catalog:${rootKey(connection)}`, title: `「${connection.name}」目录读取失败，搜索可能不完整` }); } throw error;
      } finally {
        pending.current.delete(key); setLoading(current => { const next = new Set(current); next.delete(key); return next; });
      }
    })();
    pending.current.set(key, promise); return promise;
  }
  async function loadDatabase(connection: NavigationConnection, database: string) {
    const tables = await load(connection, database) as NavigationTable[];
    const groups = [...new Set(tables.map(table => table.schema))];
    if (groups.length === 1) setExpanded(current => new Set(current).add(schemaKey(connection, database, groups[0])));
  }
  async function hydrateAll(cancelled: () => boolean, expand: boolean) {
    setIndexing(true);
    try {
      for (const connection of connections) {
        if (cancelled()) break;
        let databases: Catalog;
        try { databases = await load(connection) as Catalog; } catch { continue; }
        if (expand && !cancelled()) setExpanded(current => new Set(current).add(rootKey(connection)));
        // Three metadata requests at a time; never fetch table rows for search.
        for (let offset = 0; offset < databases.length && !cancelled(); offset += 3) {
          await Promise.all(databases.slice(offset, offset + 3).map(async ({ name }) => {
            try {
              const tables = await load(connection, name) as NavigationTable[];
              if (expand && !cancelled()) setExpanded(current => {
                const next = new Set(current).add(databaseKey(connection, name));
                for (const table of tables) next.add(schemaKey(connection, name, table.schema));
                return next;
              });
            } catch { /* Display per-target errors while other connections continue. */ }
          }));
        }
      }
    } finally { if (!cancelled()) setIndexing(false); }
  }
  useEffect(() => {
    const validRoots = new Set(connections.map(rootKey));
    for (const key of cache.current.keys()) if (![...validRoots].some(root => key === root || key.startsWith(`${root}/`))) cache.current.delete(key);
    const valid = (key: string) => [...validRoots].some(root => key === root || key.startsWith(`${root}/`));
    setErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => valid(key))));
    if (!query) return;
    let cancelled = false;
    const timer = setTimeout(() => { void hydrateAll(() => cancelled, false); }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, connectionRevision]);
  function setQuery(value: string) { setSearch(value); setSearchCollapsed(new Set()); if (!value.trim()) setIndexing(false); }
  function collapseAll() {
    bulkToken.current++; setIndexing(false); setExpanded(new Set());
    setSearchCollapsed(new Set(connections.map(rootKey)));
  }
  function expandAll() {
    const token = ++bulkToken.current; setSearchCollapsed(new Set());
    void hydrateAll(() => token !== bulkToken.current, true);
  }
  const matches = (value: string) => value.toLocaleLowerCase().includes(query);
  const connectionPath = (connection: NavigationConnection) => `${connection.name} ${connection.host ?? ''}`;
  function databaseMatches(connection: NavigationConnection, database: string) {
    const prefix = `${connectionPath(connection)} ${database}`;
    return !query || !!errors[databaseKey(connection, database)] || matches(prefix) || (schemas[databaseKey(connection, database)] ?? []).some(table => matches(`${prefix} ${table.schema} ${table.name}`));
  }
  function renderDatabase(connection: NavigationConnection, database: string) {
    const key = databaseKey(connection, database);
    const tables = schemas[key] ?? [];
    const prefix = `${connectionPath(connection)} ${database}`;
    const groups = [...new Set(tables.map(table => table.schema))].filter(schema => !query || tables.some(table => table.schema === schema && matches(`${prefix} ${schema} ${table.name}`)));
    const open = connection.engine === 'sqlite' || isOpen(key);
    return <div key={key} className="database-node">
      {connection.engine !== 'sqlite' && <Button variant="ghost" className={`catalog-node ${selectedId === connection.id && selectedDatabase === database ? 'active' : ''}`} aria-expanded={open} title={database}
        onClick={() => { toggle(key); onSelect(connection, database); if (!open) void loadDatabase(connection, database).catch(() => {}); }}>
        <AppIcon name={open ? 'chevronDown' : 'chevronRight'} size={12} /><AppIcon name="database" size={15} /><span>{database}</span>
      </Button>}
      {open && <div className="database-children">
        {loading.has(key) && <p className="catalog-status" role="status"><AppIcon name="loader" className="icon-spin" size={12} />正在读取表结构…</p>}
        {errors[key] && <div className="catalog-error"><Button variant="ghost" size="sm" onClick={() => void loadDatabase(connection, database).catch(() => {})}>重新读取目录</Button></div>}
        {groups.map(schema => {
          const groupKey = schemaKey(connection, database, schema);
          const filtered = tables.filter(table => table.schema === schema && (!query || matches(`${prefix} ${schema} ${table.name}`)));
          return <div key={groupKey} className="schema-group">
            <Button variant="ghost" className="catalog-node schema-toggle" aria-expanded={isOpen(groupKey)} onClick={() => toggle(groupKey)} title={`${schema} · 表`}>
              <AppIcon name={isOpen(groupKey) ? 'chevronDown' : 'chevronRight'} size={12} /><AppIcon name="columns" size={13} /><span>{connection.engine === 'postgres' ? schema : '表'}</span><small>{filtered.length}</small>
            </Button>
            {isOpen(groupKey) && <div className="schema-tables">{filtered.map(table => <Button variant="ghost" key={table.name} className={`table-node ${selectedId === connection.id && selectedDatabase === database && selectedTable?.schema === table.schema && selectedTable?.name === table.name ? 'active' : ''}`} title={`${database}.${schema}.${table.name}`} onClick={() => onSelect(connection, database, table)}><AppIcon name="table" size={14} /><span>{table.name}</span></Button>)}</div>}
          </div>;
        })}
        {schemas[key] && groups.length === 0 && !loading.has(key) && <p className="catalog-status">{query ? '没有匹配的数据表' : '暂无可见的数据表'}</p>}
      </div>}
    </div>;
  }
  let visible = 0;
  return <>
    <div className="navigation-search icon-input"><AppIcon name="search" size={14} /><Input value={search} onChange={event => setQuery(event.target.value)} placeholder="搜索连接、数据库或表…" aria-label="搜索连接、数据库或表" />{search && <Button variant="ghost" size="icon" className="clear-search" aria-label="清除搜索" title="清除搜索" onClick={() => setQuery('')}><AppIcon name="close" size={12} /></Button>}</div>
    <div className="navigation-tools"><Button variant="ghost" size="sm" disabled={indexing || !connections.length} onClick={expandAll}><AppIcon name="chevronDown" size={13} />展开全部</Button><Button variant="ghost" size="sm" disabled={!connections.length} onClick={collapseAll}><AppIcon name="chevronUp" size={13} />收起全部</Button></div>
    {indexing && <p className="navigation-progress" role="status">正在检索连接中的数据库和表…</p>}
    <div className="connection-tree">
      {!connections.length && <p className="sidebar-empty">暂无连接。新建连接后可浏览数据库。</p>}
      {connections.map(connection => {
        const key = rootKey(connection); const databases = catalogs[key] ?? [];
        const filtered = databases.filter(database => databaseMatches(connection, database.name));
        if (query && !matches(connectionPath(connection)) && !filtered.length && catalogs[key] && !indexing && !errors[key]) return null;
        visible++;
        return <div className="connection-node" key={key}>
          <div className="connection-row"><Button variant="ghost" className={`connection-item ${selectedId === connection.id ? 'active' : ''}`} aria-expanded={isOpen(key)} title={`${connection.name}${connection.host ? ` · ${connection.host}` : ''}`}
            onClick={() => {
              const open = isOpen(key); toggle(key);
              if (!open) {
                onSelect(connection, connection.engine === 'sqlite' ? 'main' : connection.database || undefined);
                void load(connection).then(() => { if (connection.engine === 'sqlite') return loadDatabase(connection, 'main'); }).catch(() => {});
              }
            }}>
            <AppIcon name={isOpen(key) ? 'chevronDown' : 'chevronRight'} className="tree-chevron" size={12} /><AppIcon name={connection.engine === 'sqlite' ? 'fileDatabase' : 'database'} className="database-icon" size={16} />
            <span className="connection-copy"><strong>{connection.name}</strong><small>{connection.engine === 'sqlite' ? 'SQLite' : connection.engine === 'postgres' ? 'PostgreSQL' : 'MySQL'}</small></span>
          </Button><div className="connection-row-actions">
            <Button variant="ghost" size="icon" aria-label={`测试连接 ${connection.name}`} title="测试连接" disabled={tests[connection.id]?.status === 'testing'} onClick={() => onTest(connection.id)}><AppIcon name={tests[connection.id]?.status === 'testing' ? 'loader' : 'plug'} className={tests[connection.id]?.status === 'testing' ? 'icon-spin' : undefined} size={14} /></Button>
            <Button variant="ghost" size="icon" aria-label={`连接设置 ${connection.name}`} title="连接设置" onClick={() => onEdit(connection.id)}><AppIcon name="settings" size={14} /></Button>
            <Button variant="ghost" size="icon" className="delete-connection" aria-label={`删除连接 ${connection.name}`} title="删除连接记录" onClick={event => onDelete(connection, event.currentTarget)}><AppIcon name="trash" size={14} /></Button>
          </div></div>
          {isOpen(key) && <div className="tree-children">
            {loading.has(key) && <p className="catalog-status" role="status">正在读取数据库…</p>}
            {errors[key] && <div className="catalog-error"><Button variant="ghost" size="sm" onClick={() => void load(connection).catch(() => {})}>重新读取目录</Button></div>}
            {filtered.map(database => renderDatabase(connection, database.name))}
            {catalogs[key] && !databases.length && <p className="catalog-status">暂无可访问的数据库</p>}
          </div>}
        </div>;
      })}
      {!!connections.length && !visible && <p className="sidebar-empty">没有匹配的连接、数据库或表</p>}
    </div>
  </>;
}
