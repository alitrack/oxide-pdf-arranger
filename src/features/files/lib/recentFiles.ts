export function updateRecentFiles(
  currentFiles: string[],
  nextFile: string,
  limit: number,
): string[] {
  const deduplicated = currentFiles.filter((file) => file !== nextFile);
  return [nextFile, ...deduplicated].slice(0, Math.max(1, limit));
}
