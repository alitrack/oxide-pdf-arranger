import type { PdfDocumentSummary } from "../../backend/types/pdf";
import {
  createEmptyActionHistory,
  type ActionHistoryState,
} from "./actionHistory";

export interface PdfWorkspaceDocumentSession {
  id: string;
  document: PdfDocumentSummary;
  selectedPageNumbers: number[];
  selectionAnchorPage: number | null;
  actionHistory: ActionHistoryState;
}

export interface ActiveWorkspaceDocumentState {
  activeDocument: PdfDocumentSummary | null;
  selectedPageNumbers: number[];
  selectionAnchorPage: number | null;
  actionHistory: ActionHistoryState;
}

function getDefaultSelection(document: PdfDocumentSummary) {
  const firstPageNumber = document.pages[0]?.pageNumber ?? null;

  return {
    selectedPageNumbers: firstPageNumber === null ? [] : [firstPageNumber],
    selectionAnchorPage: firstPageNumber,
  };
}

export function createWorkspaceDocumentSession(
  document: PdfDocumentSummary,
): PdfWorkspaceDocumentSession {
  return {
    id: document.path,
    document,
    actionHistory: createEmptyActionHistory(),
    ...getDefaultSelection(document),
  };
}

export function upsertWorkspaceDocumentSession(
  sessions: PdfWorkspaceDocumentSession[],
  session: PdfWorkspaceDocumentSession,
): PdfWorkspaceDocumentSession[] {
  const existingIndex = sessions.findIndex((item) => item.id === session.id);
  if (existingIndex === -1) {
    return [...sessions, session];
  }

  return sessions.map((item, index) => (index === existingIndex ? session : item));
}

export function getWorkspaceDocumentSession(
  sessions: PdfWorkspaceDocumentSession[],
  documentId: string | null,
): PdfWorkspaceDocumentSession | null {
  if (!documentId) {
    return null;
  }

  return sessions.find((item) => item.id === documentId) ?? null;
}

export function updateWorkspaceDocumentSession(
  sessions: PdfWorkspaceDocumentSession[],
  documentId: string,
  updater: (session: PdfWorkspaceDocumentSession) => PdfWorkspaceDocumentSession,
): PdfWorkspaceDocumentSession[] {
  return sessions.map((session) =>
    session.id === documentId ? updater(session) : session,
  );
}

export function removeWorkspaceDocumentSession(
  sessions: PdfWorkspaceDocumentSession[],
  documentId: string,
): PdfWorkspaceDocumentSession[] {
  return sessions.filter((session) => session.id !== documentId);
}

export function resolveNextActiveWorkspaceDocumentId(
  sessions: PdfWorkspaceDocumentSession[],
  removedDocumentId: string,
  activeDocumentId: string | null,
): string | null {
  const remainingSessions = removeWorkspaceDocumentSession(sessions, removedDocumentId);

  if (remainingSessions.length === 0) {
    return null;
  }

  if (activeDocumentId && activeDocumentId !== removedDocumentId) {
    return (
      remainingSessions.find((session) => session.id === activeDocumentId)?.id ??
      remainingSessions[0]?.id ??
      null
    );
  }

  const removedIndex = sessions.findIndex((session) => session.id === removedDocumentId);
  const nextSession =
    remainingSessions[removedIndex] ?? remainingSessions[remainingSessions.length - 1];

  return nextSession?.id ?? null;
}

export function resolveSecondaryWorkspaceDocumentId(
  sessions: PdfWorkspaceDocumentSession[],
  activeDocumentId: string | null,
  requestedSecondaryDocumentId: string | null,
): string | null {
  if (!activeDocumentId) {
    return null;
  }

  if (
    requestedSecondaryDocumentId &&
    requestedSecondaryDocumentId !== activeDocumentId &&
    sessions.some((session) => session.id === requestedSecondaryDocumentId)
  ) {
    return requestedSecondaryDocumentId;
  }

  return (
    sessions.find((session) => session.id !== activeDocumentId)?.id ?? null
  );
}

export function renameWorkspaceDocumentSession(
  sessions: PdfWorkspaceDocumentSession[],
  previousDocumentId: string,
  nextDocument: PdfDocumentSummary,
): PdfWorkspaceDocumentSession[] {
  return sessions.map((session) =>
    session.id === previousDocumentId
      ? {
          ...session,
          id: nextDocument.path,
          document: nextDocument,
        }
      : session,
  );
}

export function normalizeMergeSelectionDocumentIds(
  sessions: PdfWorkspaceDocumentSession[],
  requestedDocumentIds: string[],
): string[] {
  const sessionIds = sessions.map((session) => session.id);
  const requested = new Set(requestedDocumentIds);
  const normalized = sessionIds.filter((documentId) => requested.has(documentId));

  return normalized.length > 0 ? normalized : sessionIds;
}

export function hasWorkspaceDocumentSessionHistory(
  session: Pick<PdfWorkspaceDocumentSession, "actionHistory">,
): boolean {
  return (
    session.actionHistory.undoStack.length > 0 ||
    session.actionHistory.redoStack.length > 0
  );
}

export function projectActiveWorkspaceDocumentState(
  sessions: PdfWorkspaceDocumentSession[],
  activeDocumentId: string | null,
): ActiveWorkspaceDocumentState {
  const activeSession = getWorkspaceDocumentSession(sessions, activeDocumentId);

  if (!activeSession) {
    return {
      activeDocument: null,
      selectedPageNumbers: [],
      selectionAnchorPage: null,
      actionHistory: createEmptyActionHistory(),
    };
  }

  return {
    activeDocument: activeSession.document,
    selectedPageNumbers: activeSession.selectedPageNumbers,
    selectionAnchorPage: activeSession.selectionAnchorPage,
    actionHistory: activeSession.actionHistory,
  };
}
