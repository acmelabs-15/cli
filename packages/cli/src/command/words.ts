/**
 * Whether two word lists, such as two command lines or two command paths, have the same words in
 * the same order.
 */
export function sameWords(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((word, index) => word === right[index]);
}

/** A count and its unit in words: 1 minute, 90 seconds. */
function countOf(count: number, unit: string): string {
  return count === 1 ? `1 ${unit}` : `${count} ${unit}s`;
}

/** A time in words, in its largest whole unit: 5 minutes, 90 seconds, 1500 milliseconds. */
export function durationOf(ms: number): string {
  if (ms % 60_000 === 0) {
    return countOf(ms / 60_000, "minute");
  }
  if (ms % 1000 === 0) {
    return countOf(ms / 1000, "second");
  }
  return countOf(ms, "millisecond");
}

/** A size in words, in its largest whole unit, with 1024 bytes a KB: 10 MB, 64 KB, 1500 bytes. */
export function sizeOf(bytes: number): string {
  if (bytes % (1024 * 1024) === 0) {
    return `${bytes / (1024 * 1024)} MB`;
  }
  if (bytes % 1024 === 0) {
    return `${bytes / 1024} KB`;
  }
  return countOf(bytes, "byte");
}
