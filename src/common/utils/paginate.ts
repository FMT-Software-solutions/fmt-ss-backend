export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
}

/** Zero-based [from, to] range for PostgREST's .range(). */
export function toRange(page = 1, limit = 25): [number, number] {
  const start = (page - 1) * limit;
  return [start, start + limit - 1];
}

/**
 * Parses `column.direction` (e.g. `created_at.desc`) against a whitelist so a
 * caller can't sort by an arbitrary column.
 */
export function parseSort(
  sort: string | undefined,
  allowedColumns: string[],
  fallback: { column: string; ascending: boolean },
): { column: string; ascending: boolean } {
  if (!sort) return fallback;

  const [column, direction] = sort.split('.');
  if (!column || !allowedColumns.includes(column)) return fallback;

  return { column, ascending: direction !== 'desc' };
}

/**
 * Builds an `or` filter matching a search term against several text columns.
 * Commas and parentheses would break out of PostgREST's filter grammar, so
 * they are stripped rather than escaped.
 */
export function buildSearchFilter(search: string, columns: string[]): string {
  const term = search.replace(/[,()*]/g, '').trim();
  return columns.map((column) => `${column}.ilike.%${term}%`).join(',');
}

export function paginated<T>(
  data: T[] | null,
  count: number | null,
  page: number,
  limit: number,
): PaginatedResult<T> {
  return {
    data: data ?? [],
    meta: { page, limit, total: count ?? 0 },
  };
}
