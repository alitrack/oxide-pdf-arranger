import { invoke } from "@tauri-apps/api/core";
import type { TauriCommandErrorPayload } from "../../features/backend/types/pdf";

const UNKNOWN_COMMAND_ERROR = "unknown_command_error";

function isCommandErrorPayload(value: unknown): value is TauriCommandErrorPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

function normalizeCommandError(error: unknown): TauriInvokeError {
  if (isCommandErrorPayload(error)) {
    return new TauriInvokeError(error.message, error.code, error);
  }

  if (error instanceof Error) {
    return new TauriInvokeError(error.message, UNKNOWN_COMMAND_ERROR, error);
  }

  if (typeof error === "string") {
    return new TauriInvokeError(error, UNKNOWN_COMMAND_ERROR, error);
  }

  return new TauriInvokeError("Unknown Tauri command failure.", UNKNOWN_COMMAND_ERROR, error);
}

export class TauriInvokeError extends Error {
  readonly code: string;
  readonly causePayload: unknown;

  constructor(message: string, code: string, causePayload: unknown) {
    super(message);
    this.name = "TauriInvokeError";
    this.code = code;
    this.causePayload = causePayload;
  }
}

export async function invokeCommand<TResponse>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResponse> {
  try {
    return await invoke<TResponse>(command, args);
  } catch (error) {
    throw normalizeCommandError(error);
  }
}
