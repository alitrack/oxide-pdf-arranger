const WORKSPACE_STORAGE_KEY = "oxide-pdf-arranger.workspace";

export interface WorkspaceStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistedWorkspaceState {
  openDocumentPaths: string[];
  activeDocumentId: string | null;
  isSplitViewEnabled: boolean;
  secondaryDocumentId: string | null;
  mergeSelectionDocumentIds: string[];
}

function getDefaultStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function sanitizePersistedWorkspaceState(
  value: unknown,
): PersistedWorkspaceState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const openDocumentPaths = Array.isArray(candidate.openDocumentPaths)
    ? Array.from(
        new Set(
          candidate.openDocumentPaths.filter(
            (path): path is string => typeof path === "string" && path.length > 0,
          ),
        ),
      )
    : [];

  if (openDocumentPaths.length === 0) {
    return null;
  }

  const requestedActiveDocumentId =
    typeof candidate.activeDocumentId === "string"
      ? candidate.activeDocumentId
      : null;
  const activeDocumentId = openDocumentPaths.includes(requestedActiveDocumentId ?? "")
    ? requestedActiveDocumentId
    : openDocumentPaths[0] ?? null;

  const isSplitViewEnabled = candidate.isSplitViewEnabled === true;
  const requestedSecondaryDocumentId =
    typeof candidate.secondaryDocumentId === "string"
      ? candidate.secondaryDocumentId
      : null;
  const secondaryDocumentId =
    isSplitViewEnabled && activeDocumentId
      ? openDocumentPaths.find(
          (path) =>
            path !== activeDocumentId &&
            (path === requestedSecondaryDocumentId || requestedSecondaryDocumentId === null),
        ) ??
        openDocumentPaths.find((path) => path !== activeDocumentId) ??
        null
      : null;

  const requestedMergeSelection = Array.isArray(candidate.mergeSelectionDocumentIds)
    ? new Set(
        candidate.mergeSelectionDocumentIds.filter(
          (path): path is string => typeof path === "string" && path.length > 0,
        ),
      )
    : new Set<string>();
  const mergeSelectionDocumentIds = openDocumentPaths.filter((path) =>
    requestedMergeSelection.has(path),
  );

  return {
    openDocumentPaths,
    activeDocumentId,
    isSplitViewEnabled,
    secondaryDocumentId,
    mergeSelectionDocumentIds:
      mergeSelectionDocumentIds.length > 0
        ? mergeSelectionDocumentIds
        : openDocumentPaths,
  };
}

export function getStoredWorkspaceState(
  storage: WorkspaceStorageLike | null = getDefaultStorage(),
): PersistedWorkspaceState | null {
  if (!storage) {
    return null;
  }

  try {
    const payload = storage.getItem(WORKSPACE_STORAGE_KEY);
    if (!payload) {
      return null;
    }

    return sanitizePersistedWorkspaceState(JSON.parse(payload));
  } catch {
    return null;
  }
}

export function persistWorkspaceState(
  state: PersistedWorkspaceState,
  storage: WorkspaceStorageLike | null = getDefaultStorage(),
) {
  if (!storage) {
    return;
  }

  storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state));
}

export function clearStoredWorkspaceState(
  storage: WorkspaceStorageLike | null = getDefaultStorage(),
) {
  if (!storage) {
    return;
  }

  storage.removeItem(WORKSPACE_STORAGE_KEY);
}
