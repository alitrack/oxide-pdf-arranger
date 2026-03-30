interface HistorySnapshotPaths {
  beforeSnapshotPath: string;
  afterSnapshotPath: string;
}

function splitPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");

  if (lastSlash === -1) {
    return {
      directory: ".",
      basename: normalized,
      separator: path.includes("\\") ? "\\" : "/",
    };
  }

  const separator = path.includes("\\") ? "\\" : "/";
  const directory = path.slice(0, lastSlash).replace(/\//g, separator);
  const basename = path.slice(lastSlash + 1);

  return {
    directory,
    basename,
    separator,
  };
}

function sanitizeStem(stem: string) {
  return stem
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function buildHistorySnapshotPaths(
  documentPath: string,
  actionId: string,
): HistorySnapshotPaths {
  const { directory, basename, separator } = splitPath(documentPath);
  const stem = sanitizeStem(basename) || "document";
  const historyDirectory = [directory, ".oxide-pdf-arranger-history"]
    .filter(Boolean)
    .join(separator);

  return {
    beforeSnapshotPath: [historyDirectory, `${stem}-${actionId}-before.pdf`].join(separator),
    afterSnapshotPath: [historyDirectory, `${stem}-${actionId}-after.pdf`].join(separator),
  };
}
