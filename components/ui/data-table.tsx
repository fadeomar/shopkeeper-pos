'use client';

import { useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useLocale } from '@/components/providers/locale-context';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { typographyClasses } from '@/lib/design/variants';

export interface DataTableLabels {
  searchPlaceholder?: string;
  loading?: ReactNode;
  page?: ReactNode;
  of?: ReactNode;
  rowsPerPage?: string;
  first?: ReactNode;
  previous?: ReactNode;
  next?: ReactNode;
  last?: ReactNode;
}

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  title?: ReactNode;
  description?: ReactNode;
  toolbar?: ReactNode;
  className?: string;
  loading?: boolean;
  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  enableGlobalSearch?: boolean;
  searchPlaceholder?: string;
  pageSize?: number;
  pageSizeOptions?: number[];
  getRowId?: (row: TData, index: number) => string;
  labels?: DataTableLabels;
}

export function DataTable<TData>({
  columns,
  data,
  title,
  description,
  toolbar,
  className,
  loading,
  emptyTitle = 'No results',
  emptyDescription,
  enableGlobalSearch = true,
  searchPlaceholder = 'Search…',
  pageSize = 10,
  pageSizeOptions = [10, 25, 50, 100],
  getRowId,
  labels,
}: DataTableProps<TData>) {
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { globalFilter, sorting },
    initialState: { pagination: { pageSize } },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: getRowId ? (row, index) => getRowId(row, index) : undefined,
  });

  const tableLabels = {
    searchPlaceholder: labels?.searchPlaceholder ?? searchPlaceholder,
    loading: labels?.loading ?? 'Loading…',
    page: labels?.page ?? 'Page',
    of: labels?.of ?? 'of',
    rowsPerPage: labels?.rowsPerPage ?? 'Rows per page',
    first: labels?.first ?? 'First',
    previous: labels?.previous ?? 'Previous',
    next: labels?.next ?? 'Next',
    last: labels?.last ?? 'Last',
  };

  const rows = table.getRowModel().rows;
  const colSpan = table.getAllLeafColumns().length || 1;
  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;

  const visiblePageSizes = useMemo(() => {
    const set = new Set([...pageSizeOptions, pageSize]);
    return Array.from(set).sort((a, b) => a - b);
  }, [pageSize, pageSizeOptions]);

  return (
    <div className={clsx('rounded-2xl border border-slate-200 bg-white shadow-xs', className)}>
      {(title || description || toolbar || enableGlobalSearch) && (
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
          {(title || description) && (
            <div className="min-w-0">
              {title && <h3 className="text-sm font-semibold text-slate-900">{title}</h3>}
              {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {toolbar}
            {enableGlobalSearch && (
              <Input
                value={globalFilter}
                onChange={(event) => setGlobalFilter(event.target.value)}
                placeholder={tableLabels.searchPlaceholder}
                className="sm:w-64"
              />
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-full text-sm">
          <thead className="bg-slate-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-slate-200">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <th key={header.id} className={typographyClasses.tableHead}>
                      {header.isPlaceholder ? null : (
                        <button
                          type="button"
                          className={clsx('inline-flex items-center gap-1 text-start', canSort && 'cursor-pointer hover:text-slate-800')}
                          onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                          disabled={!canSort}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted && <span aria-hidden="true">{sorted === 'asc' ? '↑' : '↓'}</span>}
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-slate-500">{tableLabels.loading}</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-4 py-10">
                  <EmptyState title={emptyTitle} description={emptyDescription} compact />
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-slate-50/70">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={typographyClasses.tableCell}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 border-t border-slate-100 p-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {tableLabels.page} <span className="font-semibold text-slate-900">{pageCount === 0 ? 0 : pageIndex + 1}</span> {tableLabels.of}{' '}
          <span className="font-semibold text-slate-900">{pageCount}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={String(table.getState().pagination.pageSize)}
            onChange={(event) => table.setPageSize(Number(event.target.value))}
            className="w-24"
            aria-label={tableLabels.rowsPerPage}
          >
            {visiblePageSizes.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>
          <Button type="button" variant="outline" size="sm" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>{tableLabels.first}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>{tableLabels.previous}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>{tableLabels.next}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => table.setPageIndex(Math.max(pageCount - 1, 0))} disabled={!table.getCanNextPage()}>{tableLabels.last}</Button>
        </div>
      </div>
    </div>
  );
}

export function useDataTableLabels(): DataTableLabels {
  const { t } = useLocale();
  return {
    searchPlaceholder: t('dataTable.search'),
    loading: t('dataTable.loading'),
    page: t('dataTable.page'),
    of: t('dataTable.of'),
    rowsPerPage: t('dataTable.rowsPerPage'),
    first: t('dataTable.first'),
    previous: t('dataTable.previous'),
    next: t('dataTable.next'),
    last: t('dataTable.last'),
  };
}
