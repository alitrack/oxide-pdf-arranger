import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { usePdfDocumentStore } from "../../documents/store/pdfDocumentStore";
import { PageGrid } from "../../documents/components/PageGrid";
import {
  describeRedoAction,
  describeUndoAction,
} from "../../documents/lib/actionHistory";
import { useWorkspaceTheme } from "../../workspace/hooks/useWorkspaceTheme";
import {
  getSingleSavePath,
  getSingleSelectedPath,
} from "../../files/lib/dialogSelection";
import { hasWorkspaceDocumentSessionHistory } from "../../documents/lib/workspaceDocuments";
import { CropEditorModal } from "../../crop/components/CropEditorModal";
import {
  getImageImportDialogExtensions,
  resolveImageImportPlacement,
} from "../../images/lib/imageImport";

const operationCards = [
  {
    command: "inspect_pdf",
    title: "Inspect",
    description: "读取页数、MediaBox、CropBox 与 Rotate 元数据。",
    contract: "path -> PdfDocumentSummary",
  },
  {
    command: "merge_pdfs",
    title: "Merge",
    description: "按输入顺序合并多个 PDF，并返回输出文档页数。",
    contract: "MergePdfRequest -> PdfOperationResult",
  },
  {
    command: "split_pdf",
    title: "Split",
    description: "按显式页号提取新文档，适合作为后续页面选择的基础。",
    contract: "SplitPdfRequest -> PdfOperationResult",
  },
  {
    command: "rotate_pdf",
    title: "Rotate",
    description: "按 90 度步进修改页面旋转，并维护页面 box 尺寸。",
    contract: "RotatePdfRequest -> PdfOperationResult",
  },
] as const;

function formatBox(box: [number, number, number, number]) {
  return box.map((value) => value.toFixed(0)).join(" / ");
}

function formatSize(box: [number, number, number, number]) {
  return `${box[2] - box[0]} × ${box[3] - box[1]}`;
}

function getDocumentTabLabel(path: string) {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] ?? path;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

export function BackendWorkspace() {
  const { themePreference, resolvedTheme, setThemePreference } =
    useWorkspaceTheme();
  const pdfPath = usePdfDocumentStore((state) => state.draftPath);
  const openDocuments = usePdfDocumentStore((state) => state.openDocuments);
  const activeDocumentId = usePdfDocumentStore((state) => state.activeDocumentId);
  const isSplitViewEnabled = usePdfDocumentStore((state) => state.isSplitViewEnabled);
  const secondaryDocumentId = usePdfDocumentStore((state) => state.secondaryDocumentId);
  const mergeSelectionDocumentIds = usePdfDocumentStore(
    (state) => state.mergeSelectionDocumentIds,
  );
  const lastError = usePdfDocumentStore((state) => state.lastError);
  const lastOperationMessage = usePdfDocumentStore(
    (state) => state.lastOperationMessage,
  );
  const documentSummary = usePdfDocumentStore((state) => state.activeDocument);
  const isInspecting = usePdfDocumentStore((state) => state.isInspecting);
  const isSaving = usePdfDocumentStore((state) => state.isSaving);
  const isExporting = usePdfDocumentStore((state) => state.isExporting);
  const isMerging = usePdfDocumentStore((state) => state.isMerging);
  const isImportingImages = usePdfDocumentStore(
    (state) => state.isImportingImages,
  );
  const imageImportProgressTotal = usePdfDocumentStore(
    (state) => state.imageImportProgressTotal,
  );
  const isUndoing = usePdfDocumentStore((state) => state.isUndoing);
  const isRedoing = usePdfDocumentStore((state) => state.isRedoing);
  const isRotating = usePdfDocumentStore((state) => state.isRotating);
  const isCropping = usePdfDocumentStore((state) => state.isCropping);
  const isReordering = usePdfDocumentStore((state) => state.isReordering);
  const isDeleting = usePdfDocumentStore((state) => state.isDeleting);
  const isDuplicating = usePdfDocumentStore((state) => state.isDuplicating);
  const isInsertingBlank = usePdfDocumentStore((state) => state.isInsertingBlank);
  const recentFiles = usePdfDocumentStore((state) => state.recentFiles);
  const selectedPageNumbers = usePdfDocumentStore((state) => state.selectedPageNumbers);
  const gridItemWidth = usePdfDocumentStore((state) => state.gridItemWidth);
  const actionHistory = usePdfDocumentStore((state) => state.actionHistory);
  const setDraftPath = usePdfDocumentStore((state) => state.setDraftPath);
  const inspectPdf = usePdfDocumentStore((state) => state.inspectPdf);
  const restoreWorkspace = usePdfDocumentStore((state) => state.restoreWorkspace);
  const switchToDocument = usePdfDocumentStore((state) => state.switchToDocument);
  const closeDocument = usePdfDocumentStore((state) => state.closeDocument);
  const toggleSplitView = usePdfDocumentStore((state) => state.toggleSplitView);
  const setSecondaryDocument = usePdfDocumentStore((state) => state.setSecondaryDocument);
  const toggleDocumentMergeSelection = usePdfDocumentStore(
    (state) => state.toggleDocumentMergeSelection,
  );
  const mergeSelectedDocuments = usePdfDocumentStore(
    (state) => state.mergeSelectedDocuments,
  );
  const importImages = usePdfDocumentStore((state) => state.importImages);
  const selectPage = usePdfDocumentStore((state) => state.selectPage);
  const movePageToDocument = usePdfDocumentStore((state) => state.movePageToDocument);
  const rotateSelectedPages = usePdfDocumentStore(
    (state) => state.rotateSelectedPages,
  );
  const cropSelectedPages = usePdfDocumentStore((state) => state.cropSelectedPages);
  const reorderPages = usePdfDocumentStore((state) => state.reorderPages);
  const saveDocumentAs = usePdfDocumentStore((state) => state.saveDocumentAs);
  const exportDocumentCopy = usePdfDocumentStore(
    (state) => state.exportDocumentCopy,
  );
  const undoLastAction = usePdfDocumentStore((state) => state.undoLastAction);
  const redoLastAction = usePdfDocumentStore((state) => state.redoLastAction);
  const deleteSelectedPages = usePdfDocumentStore(
    (state) => state.deleteSelectedPages,
  );
  const duplicateSelectedPages = usePdfDocumentStore(
    (state) => state.duplicateSelectedPages,
  );
  const insertBlankPageAfterSelection = usePdfDocumentStore(
    (state) => state.insertBlankPageAfterSelection,
  );
  const zoomInGrid = usePdfDocumentStore((state) => state.zoomInGrid);
  const zoomOutGrid = usePdfDocumentStore((state) => state.zoomOutGrid);
  const resetGridZoom = usePdfDocumentStore((state) => state.resetGridZoom);
  const isApplyingPageAction =
    isUndoing ||
    isRedoing ||
    isRotating ||
    isCropping ||
    isReordering ||
    isDeleting ||
    isDuplicating ||
    isInsertingBlank;
  const isFileActionBusy =
    isInspecting ||
    isSaving ||
    isExporting ||
    isMerging ||
    isImportingImages ||
    isApplyingPageAction;
  const nextUndoLabel = describeUndoAction(actionHistory);
  const nextRedoLabel = describeRedoAction(actionHistory);
  const secondaryDocumentSession =
    openDocuments.find((session) => session.id === secondaryDocumentId) ?? null;
  const selectedMergeSessions = openDocuments.filter((session) =>
    mergeSelectionDocumentIds.includes(session.id),
  );
  const hasSessionHistory = openDocuments.some(hasWorkspaceDocumentSessionHistory);
  const selectedCropPage =
    selectedPageNumbers.length > 0
      ? documentSummary?.pages.find(
          (page) => page.pageNumber === selectedPageNumbers[0],
        ) ?? null
      : null;
  const [crossDocumentDrag, setCrossDocumentDrag] = useState<{
    sourcePageNumber: number;
    targetPageNumber: number | null;
  } | null>(null);
  const [isCropEditorOpen, setIsCropEditorOpen] = useState(false);
  const [imageImportPlacement, setImageImportPlacement] = useState<
    "append" | "prepend" | "after-selection"
  >("after-selection");

  useEffect(() => {
    void restoreWorkspace();
  }, [restoreWorkspace]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasSessionHistory) {
        return;
      }

      event.preventDefault();
      event.returnValue =
        "页面改动已写入磁盘，但关闭窗口会清空当前工作区的撤销/重做历史。";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasSessionHistory]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!documentSummary || isApplyingPageAction || isEditableTarget(event.target)) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          void redoLastAction();
        } else {
          void undoLastAction();
        }
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        void deleteSelectedPages();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        void duplicateSelectedPages();
        return;
      }

      if (event.key.toLowerCase() === "r" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        void rotateSelectedPages(event.shiftKey ? 270 : 90);
        return;
      }

      if (event.key.toLowerCase() === "b" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        void insertBlankPageAfterSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    deleteSelectedPages,
    documentSummary,
    duplicateSelectedPages,
    insertBlankPageAfterSelection,
    isApplyingPageAction,
    redoLastAction,
    rotateSelectedPages,
    undoLastAction,
  ]);

  async function handleInspect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await inspectPdf();
  }

  async function handleBrowseAndInspect() {
    const selectedPath = getSingleSelectedPath(
      await open({
        directory: false,
        filters: [
          {
            name: "PDF",
            extensions: ["pdf"],
          },
        ],
        multiple: false,
        title: "Open PDF document",
      }),
    );

    if (!selectedPath) {
      return;
    }

    setDraftPath(selectedPath);
    await inspectPdf(selectedPath);
  }

  async function handleSaveAs() {
    if (!documentSummary) {
      return;
    }

    const outputPath = getSingleSavePath(
      await save({
        defaultPath: documentSummary.path,
        filters: [
          {
            name: "PDF",
            extensions: ["pdf"],
          },
        ],
        title: "Save PDF as",
      }),
    );

    if (!outputPath) {
      return;
    }

    await saveDocumentAs(outputPath);
  }

  async function handleExportCopy() {
    if (!documentSummary) {
      return;
    }

    const outputPath = getSingleSavePath(
      await save({
        defaultPath: documentSummary.path.replace(/\.pdf$/i, "-copy.pdf"),
        filters: [
          {
            name: "PDF",
            extensions: ["pdf"],
          },
        ],
        title: "Export PDF copy",
      }),
    );

    if (!outputPath) {
      return;
    }

    await exportDocumentCopy(outputPath);
  }

  async function handleMergeDocuments() {
    if (selectedMergeSessions.length < 2) {
      return;
    }

    const basePath = selectedMergeSessions[0]?.document.path ?? documentSummary?.path;
    const defaultPath =
      basePath?.replace(/\.pdf$/i, "-merged.pdf") ?? "merged.pdf";
    const outputPath = getSingleSavePath(
      await save({
        defaultPath,
        filters: [
          {
            name: "PDF",
            extensions: ["pdf"],
          },
        ],
        title: "Merge selected documents",
      }),
    );

    if (!outputPath) {
      return;
    }

    await mergeSelectedDocuments(outputPath);
  }

  async function handleApplyCrop(margins: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }) {
    await cropSelectedPages(margins);
    setIsCropEditorOpen(false);
  }

  async function handleImportImages() {
    if (!documentSummary) {
      return;
    }

    const selectedPaths = await open({
      directory: false,
      filters: [
        {
          name: "Images",
          extensions: getImageImportDialogExtensions(),
        },
      ],
      multiple: true,
      title: "Import images as PDF pages",
    });
    const imagePaths = Array.isArray(selectedPaths)
      ? selectedPaths.filter((path): path is string => typeof path === "string")
      : selectedPaths
        ? [selectedPaths]
        : [];

    if (imagePaths.length === 0) {
      return;
    }

    const placement = resolveImageImportPlacement(
      imageImportPlacement,
      selectedPageNumbers,
      documentSummary.pageCount,
    );

    await importImages(
      imagePaths,
      placement.position,
      placement.afterPageNumber,
    );
  }

  async function handleDropOnSecondaryDocument(targetPageNumber: number | null) {
    if (!crossDocumentDrag || !secondaryDocumentSession) {
      return;
    }

    const targetPosition =
      targetPageNumber === null
        ? secondaryDocumentSession.document.pageCount
        : secondaryDocumentSession.document.pages.findIndex(
            (page) => page.pageNumber === targetPageNumber,
          );

    setCrossDocumentDrag(null);

    await movePageToDocument(
      secondaryDocumentSession.id,
      crossDocumentDrag.sourcePageNumber,
      targetPosition === -1 ? null : targetPosition,
    );
  }

  return (
    <div className="shell">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Oxide PDF Arranger</p>
          <h1>Backend-ready workspace for page arrangement.</h1>
          <p className="lead">
            当前前端先把 Rust/Tauri 能力接通：命令契约、错误归一化、以及最小可用的
            PDF inspect 工作台已经就位，后续可以直接继续接 Zustand、缩略图和页面栅格。
          </p>
        </div>
        <div className="hero-panel">
          <p className="hero-panel-label">Foundation Checkpoint</p>
          <ul className="checkpoint-list">
            <li>Rust core ops are tested</li>
            <li>Tauri commands are wired</li>
            <li>Frontend invoke wrapper is ready</li>
          </ul>
          <div className="theme-switcher">
            <span className="theme-switcher-label">Theme</span>
            <div className="theme-toggle-group" role="group" aria-label="Workspace theme">
              {(["system", "light", "dark"] as const).map((preference) => (
                <button
                  aria-pressed={themePreference === preference}
                  className={`theme-toggle-button${themePreference === preference ? " active" : ""}`}
                  key={preference}
                  onClick={() => setThemePreference(preference)}
                  type="button"
                >
                  {preference}
                </button>
              ))}
            </div>
            <small>Resolved: {resolvedTheme}</small>
          </div>
        </div>
      </header>

      <main className="workspace-grid">
        <section className="panel panel-operations">
          <div className="panel-header">
            <p className="panel-kicker">Command Surface</p>
            <h2>Backend contracts now exposed to the frontend</h2>
          </div>
          <div className="operation-grid">
            {operationCards.map((card) => (
              <article className="operation-card" key={card.command}>
                <div className="operation-card-topline">
                  <span>{card.title}</span>
                  <code>{card.command}</code>
                </div>
                <p>{card.description}</p>
                <p className="contract">{card.contract}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="panel panel-inspector">
          <div className="panel-header">
            <p className="panel-kicker">Live Probe</p>
            <h2>Inspect a PDF by absolute path</h2>
          </div>

          <form className="inspect-form" onSubmit={handleInspect}>
            <label className="field">
              <span>PDF path</span>
              <input
                name="pdfPath"
                value={pdfPath}
                onChange={(event) => setDraftPath(event.currentTarget.value)}
                placeholder="/absolute/path/to/document.pdf"
              />
            </label>

            <button className="primary-button" disabled={isFileActionBusy} type="submit">
              {isInspecting ? "Inspecting..." : "Inspect PDF"}
            </button>
            <button
              className="secondary-button"
              disabled={isFileActionBusy}
              onClick={() => void handleBrowseAndInspect()}
              type="button"
            >
              Browse
            </button>
          </form>

          {lastError ? <div className="status-banner error">{lastError}</div> : null}
          {lastOperationMessage ? (
            <div className="status-banner success">{lastOperationMessage}</div>
          ) : null}

          {recentFiles.length > 0 ? (
            <div className="recent-files">
              <span className="recent-files-title">Recent files</span>
              <div className="recent-files-list">
                {recentFiles.map((filePath) => (
                  <button
                    className="recent-file-button"
                    key={filePath}
                    onClick={() => {
                      setDraftPath(filePath);
                      void inspectPdf(filePath);
                    }}
                    type="button"
                    disabled={isFileActionBusy}
                  >
                    {filePath}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {openDocuments.length > 0 ? (
            <div className="workspace-tabs" role="tablist" aria-label="Open PDF documents">
              {openDocuments.map((session) => (
                <div className="workspace-tab-shell" key={session.id}>
                  <button
                    aria-selected={activeDocumentId === session.id}
                    className={`workspace-tab${activeDocumentId === session.id ? " active" : ""}`}
                    disabled={isApplyingPageAction}
                    onClick={() => switchToDocument(session.id)}
                    role="tab"
                    title={session.document.path}
                    type="button"
                  >
                    <span>{getDocumentTabLabel(session.document.path)}</span>
                    <small>{session.document.pageCount} pages</small>
                  </button>
                  <button
                    aria-label={`Close ${getDocumentTabLabel(session.document.path)}`}
                    className="workspace-tab-close"
                    disabled={isApplyingPageAction}
                    onClick={() => closeDocument(session.id)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {documentSummary ? (
            <div
              className={`document-summary${isSplitViewEnabled && secondaryDocumentSession ? " split" : ""}`}
            >
              <div className="summary-topline">
                <div>
                  <p className="summary-label">Document</p>
                  <h3>{documentSummary.path}</h3>
                </div>
                <div className="summary-pill">
                  <span>{documentSummary.pageCount}</span>
                  <small>pages</small>
                </div>
              </div>

              <div className="summary-selection">
                <span>Selected</span>
                <strong>{selectedPageNumbers.length}</strong>
                <small>{selectedPageNumbers.join(", ") || "none"}</small>
              </div>

              <div className="workspace-toolbar">
                <div className="workspace-toolbar-meta">
                  <div className="workspace-toolbar-chip">
                    <span>Pages</span>
                    <strong>{documentSummary.pageCount}</strong>
                  </div>
                  <div className="workspace-toolbar-chip">
                    <span>Selected</span>
                    <strong>{selectedPageNumbers.length}</strong>
                  </div>
                </div>

                <div className="page-action-bar">
                  <span>Workspace</span>
                  <div className="page-action-buttons">
                    <button
                      className="secondary-button"
                      disabled={openDocuments.length < 2 || isApplyingPageAction}
                      onClick={() => toggleSplitView()}
                      type="button"
                    >
                      {isSplitViewEnabled ? "Single view" : "Split view"}
                    </button>
                    {isSplitViewEnabled && secondaryDocumentSession ? (
                      <label className="workspace-select-label">
                        <span>Secondary</span>
                        <select
                          className="workspace-select"
                          disabled={isApplyingPageAction}
                          onChange={(event) => setSecondaryDocument(event.currentTarget.value)}
                          value={secondaryDocumentSession.id}
                        >
                          {openDocuments
                            .filter((session) => session.id !== activeDocumentId)
                            .map((session) => (
                              <option key={session.id} value={session.id}>
                                {getDocumentTabLabel(session.document.path)}
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : null}
                    <button
                      className="secondary-button"
                      disabled={selectedMergeSessions.length < 2 || isFileActionBusy}
                      onClick={() => void handleMergeDocuments()}
                      type="button"
                    >
                      {isMerging ? "Merging..." : "Merge selected"}
                    </button>
                  </div>
                </div>

                {openDocuments.length > 1 ? (
                  <div className="page-action-bar merge-selection-bar">
                    <span>Merge scope</span>
                    <div className="merge-selection-list">
                      {openDocuments.map((session) => (
                        <label className="merge-selection-option" key={session.id}>
                          <input
                            checked={mergeSelectionDocumentIds.includes(session.id)}
                            disabled={isFileActionBusy}
                            onChange={() => toggleDocumentMergeSelection(session.id)}
                            type="checkbox"
                          />
                          <span>{getDocumentTabLabel(session.document.path)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="page-action-bar">
                  <span>History</span>
                  <div className="page-action-buttons">
                    <button
                      className="secondary-button"
                      disabled={!nextUndoLabel || isApplyingPageAction}
                      onClick={() => void undoLastAction()}
                      title={nextUndoLabel ? `撤销: ${nextUndoLabel}` : "没有可撤销的操作"}
                      type="button"
                    >
                      {isUndoing ? "Undoing..." : "Undo"}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={!nextRedoLabel || isApplyingPageAction}
                      onClick={() => void redoLastAction()}
                      title={nextRedoLabel ? `重做: ${nextRedoLabel}` : "没有可重做的操作"}
                      type="button"
                    >
                      {isRedoing ? "Redoing..." : "Redo"}
                    </button>
                  </div>
                </div>

                <div className="page-action-bar">
                  <span>File actions</span>
                  <div className="page-action-buttons">
                    <button
                      className="secondary-button"
                      disabled={isFileActionBusy}
                      onClick={() => void handleExportCopy()}
                      type="button"
                    >
                      {isExporting ? "Exporting..." : "Export copy"}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={isFileActionBusy}
                      onClick={() => void handleImportImages()}
                      type="button"
                    >
                      {isImportingImages
                        ? `Importing ${imageImportProgressTotal} image(s)...`
                        : "Import images"}
                    </button>
                    <label className="workspace-select-label">
                      <span>Insert</span>
                      <select
                        className="workspace-select"
                        disabled={isFileActionBusy}
                        onChange={(event) =>
                          setImageImportPlacement(
                            event.currentTarget.value as
                              | "append"
                              | "prepend"
                              | "after-selection",
                          )
                        }
                        value={imageImportPlacement}
                      >
                        <option value="after-selection">After selection</option>
                        <option value="append">Append</option>
                        <option value="prepend">Prepend</option>
                      </select>
                    </label>
                    <button
                      className="secondary-button"
                      disabled={isFileActionBusy}
                      onClick={() => void handleSaveAs()}
                      type="button"
                    >
                      {isSaving ? "Saving..." : "Save as"}
                    </button>
                  </div>
                </div>

                <div className="page-action-bar">
                  <span>Page actions</span>
                  <div className="page-action-buttons">
                    {[90, 180, 270].map((degrees) => (
                      <button
                        className="secondary-button"
                        disabled={selectedPageNumbers.length === 0 || isApplyingPageAction}
                        key={degrees}
                        onClick={() => rotateSelectedPages(degrees as 90 | 180 | 270)}
                        type="button"
                      >
                        {isRotating ? "Applying..." : `${degrees}°`}
                      </button>
                    ))}
                    <button
                      className="secondary-button"
                      disabled={selectedPageNumbers.length === 0 || isApplyingPageAction}
                      onClick={() => setIsCropEditorOpen(true)}
                      type="button"
                    >
                      {isCropping ? "Cropping..." : "Crop"}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={selectedPageNumbers.length === 0 || isApplyingPageAction}
                      onClick={() => insertBlankPageAfterSelection()}
                      type="button"
                    >
                      {isInsertingBlank ? "Inserting..." : "Insert blank"}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={selectedPageNumbers.length === 0 || isApplyingPageAction}
                      onClick={() => duplicateSelectedPages()}
                      type="button"
                    >
                      {isDuplicating ? "Duplicating..." : "Duplicate"}
                    </button>
                    <button
                      className="secondary-button danger"
                      disabled={selectedPageNumbers.length === 0 || isApplyingPageAction}
                      onClick={() => deleteSelectedPages()}
                      type="button"
                    >
                      {isDeleting ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="summary-metadata">
                <div className="summary-field">
                  <span>First page size</span>
                  <strong>{formatSize(documentSummary.pages[0].mediaBox)}</strong>
                </div>
                <div className="summary-field">
                  <span>First page box</span>
                  <strong>{formatBox(documentSummary.pages[0].mediaBox)}</strong>
                </div>
              </div>

              <PageGrid
                crossDocumentDropPageNumber={null}
                dragMode={
                  isSplitViewEnabled && secondaryDocumentSession
                    ? "cross-source"
                    : "reorder"
                }
                gridItemWidth={gridItemWidth}
                isLoading={isInspecting}
                isApplyingPageAction={isApplyingPageAction}
                onCrossDocumentDragEnd={() => setCrossDocumentDrag(null)}
                onCrossDocumentDragStart={(pageNumber) =>
                  setCrossDocumentDrag({
                    sourcePageNumber: pageNumber,
                    targetPageNumber: null,
                  })
                }
                onDeleteSelected={deleteSelectedPages}
                onDuplicateSelected={duplicateSelectedPages}
                onInsertBlankAfterSelection={insertBlankPageAfterSelection}
                onPageClick={selectPage}
                onReorderPages={reorderPages}
                onResetZoom={resetGridZoom}
                onRotateSelected={rotateSelectedPages}
                onZoomIn={zoomInGrid}
                onZoomOut={zoomOutGrid}
                pages={documentSummary.pages}
                selectedPageNumbers={selectedPageNumbers}
              />

              <div className="workspace-statusbar">
                <span>Open docs: {openDocuments.length}</span>
                <span>Page count: {documentSummary.pageCount}</span>
                <span>Selected: {selectedPageNumbers.length}</span>
                <span>Undo: {actionHistory.undoStack.length}</span>
                <span>Redo: {actionHistory.redoStack.length}</span>
                <span>Grid width: {gridItemWidth}px</span>
                <span>Theme: {resolvedTheme}</span>
                <span className="statusbar-path">{documentSummary.path}</span>
              </div>

              <div className="shortcut-reference">
                <span className="shortcut-reference-title">Keyboard shortcuts</span>
                <div className="shortcut-reference-grid">
                  <span>
                    <kbd>R</kbd> rotate 90°
                  </span>
                  <span>
                    <kbd>Shift</kbd> + <kbd>R</kbd> rotate 270°
                  </span>
                  <span>
                    <kbd>Ctrl/Cmd</kbd> + <kbd>D</kbd> duplicate
                  </span>
                  <span>
                    <kbd>Ctrl/Cmd</kbd> + <kbd>Z</kbd> undo
                  </span>
                  <span>
                    <kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> redo
                  </span>
                  <span>
                    <kbd>Space</kbd> pick up focused page for keyboard reorder
                  </span>
                  <span>
                    <kbd>Arrow keys</kbd> move the lifted page, <kbd>Escape</kbd> cancels
                  </span>
                  <span>
                    <kbd>B</kbd> insert blank after selection
                  </span>
                  <span>
                    <kbd>Delete</kbd> delete selected pages
                  </span>
                  <span>Touch: long press a page card to start drag reorder</span>
                </div>
              </div>

              {isSplitViewEnabled && secondaryDocumentSession ? (
                <div className="secondary-document-panel">
                  <div className="summary-topline">
                    <div>
                      <p className="summary-label">Secondary Document</p>
                      <h3>{secondaryDocumentSession.document.path}</h3>
                    </div>
                    <div className="summary-pill">
                      <span>{secondaryDocumentSession.document.pageCount}</span>
                      <small>pages</small>
                    </div>
                  </div>

                  <div className="summary-selection">
                    <span>Selected</span>
                    <strong>{secondaryDocumentSession.selectedPageNumbers.length}</strong>
                    <small>
                      {secondaryDocumentSession.selectedPageNumbers.join(", ") || "none"}
                    </small>
                  </div>

                  <div className="page-action-bar">
                    <span>Secondary View</span>
                    <div className="page-action-buttons">
                      <button
                        className="secondary-button"
                        disabled={isApplyingPageAction}
                        onClick={() => switchToDocument(secondaryDocumentSession.id)}
                        type="button"
                      >
                        Make primary
                      </button>
                    </div>
                  </div>

                  <PageGrid
                    crossDocumentDropPageNumber={crossDocumentDrag?.targetPageNumber ?? null}
                    dragMode="cross-target"
                    gridItemWidth={gridItemWidth}
                    isInteractive={false}
                    isLoading={false}
                    isApplyingPageAction={true}
                    onCrossDocumentDrop={(targetPageNumber) =>
                      void handleDropOnSecondaryDocument(targetPageNumber)
                    }
                    onCrossDocumentDropTargetChange={(targetPageNumber) =>
                      setCrossDocumentDrag((current) =>
                        current
                          ? { ...current, targetPageNumber }
                          : current,
                      )
                    }
                    onDeleteSelected={() => {}}
                    onDuplicateSelected={() => {}}
                    onInsertBlankAfterSelection={() => {}}
                    onPageClick={() => {}}
                    onReorderPages={() => {}}
                    onResetZoom={resetGridZoom}
                    onRotateSelected={() => {}}
                    onZoomIn={zoomInGrid}
                    onZoomOut={zoomOutGrid}
                    pages={secondaryDocumentSession.document.pages}
                    selectedPageNumbers={secondaryDocumentSession.selectedPageNumbers}
                  />

                  <div className="workspace-statusbar">
                    <span>Page count: {secondaryDocumentSession.document.pageCount}</span>
                    <span>Selected: {secondaryDocumentSession.selectedPageNumbers.length}</span>
                    <span>Undo: {secondaryDocumentSession.actionHistory.undoStack.length}</span>
                    <span>Redo: {secondaryDocumentSession.actionHistory.redoStack.length}</span>
                    <span className="statusbar-path">
                      {secondaryDocumentSession.document.path}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="empty-state">
              <p>No document loaded yet.</p>
              <small>
                这里先验证 Tauri invoke 与返回结构；后续可在此基础上接入文件选择器和页面缩略图。
              </small>
            </div>
          )}

          <CropEditorModal
            isApplying={isCropping}
            isOpen={isCropEditorOpen && !!selectedCropPage}
            onApply={(margins) => void handleApplyCrop(margins)}
            onClose={() => setIsCropEditorOpen(false)}
            page={selectedCropPage}
            selectedPageCount={selectedPageNumbers.length}
          />

          {!documentSummary && isInspecting ? (
            <PageGrid
              gridItemWidth={gridItemWidth}
              isLoading={isInspecting}
              isApplyingPageAction={isApplyingPageAction}
              onDeleteSelected={deleteSelectedPages}
              onDuplicateSelected={duplicateSelectedPages}
              onInsertBlankAfterSelection={insertBlankPageAfterSelection}
              onPageClick={selectPage}
              onReorderPages={reorderPages}
              onResetZoom={resetGridZoom}
              onRotateSelected={rotateSelectedPages}
              onZoomIn={zoomInGrid}
              onZoomOut={zoomOutGrid}
              pages={[]}
              selectedPageNumbers={selectedPageNumbers}
            />
          ) : null}
        </section>
      </main>
    </div>
  );
}
