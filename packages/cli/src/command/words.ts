/**
 * Whether two word lists, such as two command lines or two command paths, have the same words in
 * the same order.
 */
export function sameWords(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((word, index) => word === right[index]);
}
