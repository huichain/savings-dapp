import { isMessageKey, type MessageKey } from "../i18n/messages.ts";

export class AppError extends Error {
  readonly key: MessageKey;
  readonly detail?: string;

  constructor(key: MessageKey, detail?: string) {
    super(key);
    this.name = "AppError";
    this.key = key;
    this.detail = detail;
  }
}

export function readAppError(value: object): AppError | undefined {
  if (value instanceof AppError) return value;
  if (
    !("key" in value) ||
    typeof value.key !== "string" ||
    !isMessageKey(value.key)
  )
    return undefined;
  const detail =
    "detail" in value && typeof value.detail === "string"
      ? value.detail
      : undefined;
  return new AppError(value.key, detail);
}
