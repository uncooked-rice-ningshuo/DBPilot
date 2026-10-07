import { AppIcon } from '@ui/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel,
  useReactTable, type ColumnDef, type SortingState
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@ui/components/button';
import { Input } from '@ui/components/input';

const columnHelper = createColumnHelper<unknown[]>();

export function ResultGrid({ columns: names, rows }: { columns: string[]; rows: unknown[][] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? rows.filter(row => row.some(value => String(value ?? 'NULL').toLocaleLowerCase().includes(query))) : rows;
  }, [rows, search]);
  const columns = useMemo<ColumnDef<unknown[], unknown>[]>(() => [
    columnHelper.display({ id: 'rowNumber', header: '#', size: 48, cell: info => info.row.index + 1 }) as ColumnDef<unknown[], unknown>,
    ...names.map((name, index) => columnHelper.accessor(row => row[index], {
      id: `column-${index}`,
      header: name,
      size: 170,
      sortingFn: 'alphanumeric',
      cell: info => info.getValue() === null ? <em>NULL</em> : String(info.getValue())
    }) as ColumnDef<unknown[], unknown>)
  ], [names]);
  const table = useReactTable({
    data: visibleRows, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel()
  });
  const modelRows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: modelRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 34,
    overscan: 8
  });
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [search, sorting]);

  return <>
    <div className="grid-tools">
      <div className="icon-input"><AppIcon name="search" size={14} /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索已加载的行…" aria-label="搜索已加载的行" /></div>
      <span>{search ? `匹配 ${visibleRows.length} / ${rows.length} 行` : '点击列名排序 · 仅作用于已加载数据'}</span>
    </div>
    <div ref={scrollRef} className="table-scroll" role="region" aria-label="查询结果表格">
      <table className="virtual-table" style={{ minWidth: table.getTotalSize(), width: '100%' }}>
        <thead>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => {
          const direction = header.column.getIsSorted();
          return <th key={header.id} className={header.column.id === 'rowNumber' ? 'row-number' : ''}
            aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
            style={{ flex: header.column.id === 'rowNumber' ? `0 0 ${header.getSize()}px` : `1 0 ${header.getSize()}px` }}>
            {header.column.getCanSort() ? <Button type="button" variant="ghost" size="sm" className="column-sort"
              onClick={header.column.getToggleSortingHandler()} aria-label={`按 ${String(header.column.columnDef.header)} 排序`}>
              {flexRender(header.column.columnDef.header, header.getContext())}<AppIcon name={direction === 'asc' ? 'send' : direction === 'desc' ? 'arrowDown' : 'sort'} size={13} />
            </Button> : flexRender(header.column.columnDef.header, header.getContext())}
          </th>;
        })}</tr>)}</thead>
        <tbody style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map(item => {
            const row = modelRows[item.index];
            return <tr key={row.id} data-index={item.index} data-testid="result-row"
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}>
              {row.getVisibleCells().map(cell => <td key={cell.id} className={cell.column.id === 'rowNumber' ? 'row-number' : ''}
                style={{ flex: cell.column.id === 'rowNumber' ? `0 0 ${cell.column.getSize()}px` : `1 0 ${cell.column.getSize()}px` }}>
                {cell.column.id === 'rowNumber' ? item.index + 1 : flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>)}
            </tr>;
          })}
        </tbody>
      </table>
      {visibleRows.length === 0 && <div className="grid-no-match">没有匹配的已加载行</div>}
    </div>
  </>;
}
