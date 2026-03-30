const MAX_HISTORY_STEPS = 50;

export interface ActionHistoryEntry {
  id: string;
  label: string;
  beforeSnapshotPath: string;
  afterSnapshotPath: string;
}

export interface ActionHistoryState {
  undoStack: ActionHistoryEntry[];
  redoStack: ActionHistoryEntry[];
}

export interface ActionHistoryTransition {
  history: ActionHistoryState;
  entry: ActionHistoryEntry | null;
}

export function createEmptyActionHistory(): ActionHistoryState {
  return {
    undoStack: [],
    redoStack: [],
  };
}

export function pushHistoryEntry(
  history: ActionHistoryState,
  entry: ActionHistoryEntry,
): ActionHistoryState {
  const undoStack = [...history.undoStack, entry].slice(-MAX_HISTORY_STEPS);

  return {
    undoStack,
    redoStack: [],
  };
}

export function undoHistoryEntry(
  history: ActionHistoryState,
): ActionHistoryTransition {
  const entry = history.undoStack[history.undoStack.length - 1] ?? null;
  if (!entry) {
    return { history, entry: null };
  }

  return {
    entry,
    history: {
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, entry],
    },
  };
}

export function redoHistoryEntry(
  history: ActionHistoryState,
): ActionHistoryTransition {
  const entry = history.redoStack[history.redoStack.length - 1] ?? null;
  if (!entry) {
    return { history, entry: null };
  }

  return {
    entry,
    history: {
      undoStack: [...history.undoStack, entry].slice(-MAX_HISTORY_STEPS),
      redoStack: history.redoStack.slice(0, -1),
    },
  };
}

export function describeUndoAction(history: ActionHistoryState): string | null {
  return history.undoStack[history.undoStack.length - 1]?.label ?? null;
}

export function describeRedoAction(history: ActionHistoryState): string | null {
  return history.redoStack[history.redoStack.length - 1]?.label ?? null;
}
