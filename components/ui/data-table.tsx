'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useLocale } from '@/components/providers/locale-context';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Cell,
  type ColumnDef,
  type Row,
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
  /** Optional href used by the mobile card layout so rows become tappable detail entries. */
  getMobileRowHref?: (row: TData, index: number) => string | undefined;
  /** Optional accessible label for a tappable mobile row. */
  getMobileRowAriaLabel?: (row: TData, index: number) => string | undefined;
  /**
   * Max detail fields shown per mobile card (excludes the primary/title field).
   * Defaults to showing every column — set this only to deliberately truncate
   * very wide tables. Hiding columns silently drops information the user needs.
   */
  mobileDetailLimit?: number;
}

function isActionColumn(columnId: string): boolean {
  return /(^|[-_])(action|actions)([-_]|$)/i.test(columnId);
}

function columnLabel<TData>(cell: Cell<TData, unknown>): ReactNode {
  const header = cell.column.columnDef.header;
  if (typeof header === 'string') return header;
  if (typeof header === 'number') return String(header);
  return cell.column.id;
}

function MobileTableCards<TData>({
  rows,
  loading,
  emptyTitle,
  emptyDescription,
  loadingLabel,
  getHref,
  getAriaLabel,
  detailLimit,
}: {
  rows: Row<TData>[];
  loading?: boolean;
  emptyTitle: ReactNode;
  emptyDescription?: ReactNode;
  loadingLabel: ReactNode;
  getHref?: (row: TData, index: number) => string | undefined;
  getAriaLabel?: (row: TData, index: number) => string | undefined;
  detailLimit?: number;
}) {
  if (loading) {
    return (
      <div className="px-4 py-10 text-center text-sm text-slate-500">
        {loadingLabel}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-4 py-10">
        <EmptyState title={emptyTitle} description={emptyDescription} compact />
      </div>
    );
  }

  return (
    <div className="grid gap-3 p-3">
      {rows.map((row, index) => {
        const cells = row.getVisibleCells();
        const nonActionCells = cells.filter((cell) => !isActionColumn(cell.column.id));
        const actionCells = cells.filter((cell) => isActionColumn(cell.column.id));
        const [primaryCell, ...detailCells] = nonActionCells;
        const href = getHref?.(row.original, index);
        const ariaLabel = getAriaLabel?.(row.original, index);
        const visibleDetails =
          detailLimit != null ? detailCells.slice(0, detailLimit) : detailCells;
        const hasHiddenDetails = detailCells.length > visibleDetails.length;

        const card = (
          <div
            className={clsx(
              'touch-card rounded-2xl border border-slate-200 bg-white p-3 shadow-xs',
              href ? 'transition-colors active:bg-slate-50' : 'hover:bg-slate-50/60',
            )}
          >
            {primaryCell ? (
              <div className="min-w-0 text-sm font-semibold text-slate-900">
                {flexRender(primaryCell.column.columnDef.cell, primaryCell.getContext())}
              </div>
            ) : (
              <div className="text-sm font-semibold text-slate-900">#{index + 1}</div>
            )}

            {visibleDetails.length > 0 && (
              <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                {visibleDetails.map((cell) => (
                  <div key={cell.id} className="rounded-xl bg-slate-50 p-2">
                    <dt className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {columnLabel(cell)}
                    </dt>
                    <dd className="min-w-0 text-slate-800">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </dd>
                  </div>
                ))}
                {hasHiddenDetails && (
                  <div className="rounded-xl bg-slate-50 p-2 text-[11px] font-medium text-slate-500">
                    +{detailCells.length - visibleDetails.length}
                  </div>
                )}
              </dl>
            )}

            {!href && actionCells.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                {actionCells.map((cell) => (
                  <div key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            )}
          </div>
        );

        if (!href) return <div key={row.id}>{card}</div>;
        return (
          <Link key={row.id} href={href} aria-label={ariaLabel} className="block">
            {card}
          </Link>
        );
      })}
    </div>
  );
}

export function DataTable<TData>({
  columns,
  data,
  title,
  description,
  toolbar,
  className,
  loading,
  emptyTitle,
  emptyDescription,
  enableGlobalSearch = true,
  searchPlaceholder,
  pageSize = 10,
  pageSizeOptions = [10, 25, 50, 100],
  getRowId,
  labels,
  getMobileRowHref,
  getMobileRowAriaLabel,
  mobileDetailLimit,
}: DataTableProps<TData>) {
  const { t } = useLocale();
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  // Pull every default from the locale dict so a caller that forgets to pass
  // labels still gets the user's language, not hardcoded English.
  const resolvedEmptyTitle = emptyTitle ?? t('dataTable.noResults');
  const resolvedSearchPlaceholder = searchPlaceholder ?? t('dataTable.search');

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
    searchPlaceholder: labels?.searchPlaceholder ?? resolvedSearchPlaceholder,
    loading: labels?.loading ?? t('dataTable.loading'),
    page: labels?.page ?? t('dataTable.page'),
    of: labels?.of ?? t('dataTable.of'),
    rowsPerPage: labels?.rowsPerPage ?? t('dataTable.rowsPerPage'),
    first: labels?.first ?? t('dataTable.first'),
    previous: labels?.previous ?? t('dataTable.previous'),
    next: labels?.next ?? t('dataTable.next'),
    last: labels?.last ?? t('dataTable.last'),
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
                aria-label={tableLabels.searchPlaceholder}
                className="sm:w-64"
              />
            )}
          </div>
        </div>
      )}

      <div className="md:hidden">
        <MobileTableCards
          rows={rows}
          loading={loading}
          emptyTitle={resolvedEmptyTitle}
          emptyDescription={emptyDescription}
          loadingLabel={tableLabels.loading}
          getHref={getMobileRowHref}
          getAriaLabel={getMobileRowAriaLabel}
          detailLimit={mobileDetailLimit}
        />
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-full text-sm">
          <thead className="bg-slate-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-slate-200">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  // aria-sort is only meaningful on sortable columns.
                  const ariaSort = canSort
                    ? sorted === 'asc'
                      ? 'ascending'
                      : sorted === 'desc'
                        ? 'descending'
                        : 'none'
                    : undefined;
                  return (
                    <th key={header.id} className={typographyClasses.tableHead} aria-sort={ariaSort}>
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
                  <EmptyState title={resolvedEmptyTitle} description={emptyDescription} compact />
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

      <nav
        aria-label={t('dataTable.paginationNav')}
        className="flex flex-col gap-3 border-t border-slate-100 p-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between"
      >
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
      </nav>
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
