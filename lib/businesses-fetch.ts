export type BusinessListRow = {
  id: string;
  name: string;
  location: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
};

export async function collectBusinessesPageByPage(
  fetchPage: (args: { from: number; to: number }) => Promise<{
    data: BusinessListRow[] | null;
    error: { message?: string } | null;
  }>,
  pageSize = 200,
): Promise<BusinessListRow[]> {
  const rows: BusinessListRow[] = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await fetchPage({ from, to });
    if (error) throw new Error(error.message ?? "Failed to load businesses");
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}
