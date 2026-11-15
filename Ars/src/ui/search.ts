/** Name matches lead; descriptive metadata still makes entries discoverable. */
export function searchItems<T extends { label: string; search: string }>(items: T[], query: string): T[] {
  const normalize = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const needle = normalize(query).trim();
  if (!needle) return [];
  const words = needle.split(/\s+/);
  const rank = (label: string) => {
    const name = normalize(label).replace(/^[^\p{L}\p{N}]+/u, "");
    if (name === needle) return 0;
    if (name.startsWith(needle)) return 1;
    if (name.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(needle))) return 2;
    if (name.includes(needle)) return 3;
    return 4;
  };
  return items.filter((item) => {
    const haystack = normalize(`${item.label} ${item.search}`);
    return words.every((word) => haystack.includes(word));
  }).sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
}
