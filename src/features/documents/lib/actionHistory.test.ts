import { describe, expect, test } from "bun:test";
import {
  createEmptyActionHistory,
  pushHistoryEntry,
  redoHistoryEntry,
  undoHistoryEntry,
  type ActionHistoryEntry,
} from "./actionHistory";

function entry(id: string): ActionHistoryEntry {
  return {
    id,
    label: `Action ${id}`,
    beforeSnapshotPath: `/tmp/${id}-before.pdf`,
    afterSnapshotPath: `/tmp/${id}-after.pdf`,
  };
}

describe("actionHistory", () => {
  test("pushHistoryEntry appends a new undo step and clears redo history", () => {
    const first = pushHistoryEntry(createEmptyActionHistory(), entry("one"));
    const second = redoHistoryEntry({
      ...first,
      redoStack: [entry("redo")],
    }).history;

    const next = pushHistoryEntry(second, entry("two"));

    expect(next.undoStack.map((item) => item.id)).toEqual(["one", "redo", "two"]);
    expect(next.redoStack).toEqual([]);
  });

  test("undoHistoryEntry returns the latest action and moves it to redo", () => {
    const history = pushHistoryEntry(
      pushHistoryEntry(createEmptyActionHistory(), entry("one")),
      entry("two"),
    );

    const result = undoHistoryEntry(history);

    expect(result.entry?.id).toBe("two");
    expect(result.history.undoStack.map((item) => item.id)).toEqual(["one"]);
    expect(result.history.redoStack.map((item) => item.id)).toEqual(["two"]);
  });

  test("redoHistoryEntry returns the latest redone action and moves it back to undo", () => {
    const history = undoHistoryEntry(
      pushHistoryEntry(
        pushHistoryEntry(createEmptyActionHistory(), entry("one")),
        entry("two"),
      ),
    ).history;

    const result = redoHistoryEntry(history);

    expect(result.entry?.id).toBe("two");
    expect(result.history.undoStack.map((item) => item.id)).toEqual(["one", "two"]);
    expect(result.history.redoStack).toEqual([]);
  });

  test("pushHistoryEntry enforces the 50-step limit", () => {
    const history = Array.from({ length: 52 }, (_, index) => index + 1).reduce(
      (current, index) => pushHistoryEntry(current, entry(`${index}`)),
      createEmptyActionHistory(),
    );

    expect(history.undoStack).toHaveLength(50);
    expect(history.undoStack[0]?.id).toBe("3");
    expect(history.undoStack.at(-1)?.id).toBe("52");
  });
});
