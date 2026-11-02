/** Literal, case-insensitive matches retain UTF-16 offsets even when case folding changes length. */
export function matchRanges(text: string, query: string): Array<[number, number]> {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const ranges: Array<[number, number]> = [];
  for (const match of text.matchAll(pattern)) { ranges.push([match.index!, match.index! + match[0].length]); if (ranges.length >= 10000) break; }
  return ranges;
}
