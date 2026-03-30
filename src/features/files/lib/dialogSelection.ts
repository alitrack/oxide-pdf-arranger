export function getSingleSelectedPath(
  selection: string | string[] | null,
): string | null {
  return typeof selection === "string" ? selection : null;
}
