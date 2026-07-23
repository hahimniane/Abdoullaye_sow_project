export type SearchableOption = {
  value: string;
  label: string;
  keywords?: string;
  selectedLabel?: string;
};

function searchableText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .trim();
}

export function filterSearchableOptions(
  options: readonly SearchableOption[],
  query: string,
) {
  const normalizedQuery = searchableText(query);
  if (!normalizedQuery) return [...options];
  return options.filter((option) =>
    searchableText(`${option.label} ${option.keywords || ""}`).includes(
      normalizedQuery,
    ),
  );
}
