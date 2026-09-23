export function parsePagination(query: Record<string, string>, maxLimit = 500) {
  const limit = Math.min(Math.max(1, Number(query.limit ?? 50)), maxLimit);
  const offset = Math.max(0, Number(query.offset ?? 0));
  return { limit, offset };
}
