import { AppError, readAppError } from "./errors.ts";
import { translate, type Locale, type MessageKey } from "../i18n/messages.ts";

const U64_MAX = (1n << 64n) - 1n;

export function parseSol(value: string): bigint {
  const text = value.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(text)) throw new AppError("invalidSol");
  const [whole, fraction = ""] = text.split(".");
  const amount =
    BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
  if (amount <= 0n || amount > U64_MAX) throw new AppError("targetOutOfRange");
  return amount;
}

export function formatSol(value: bigint): string {
  const fraction = (value % 1_000_000_000n)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return `${value / 1_000_000_000n}${fraction ? `.${fraction}` : ""}`;
}

export function parseGoal(
  name: string,
  target: string,
  unlock: string,
  now = Date.now()
) {
  if (!name.trim() || new TextEncoder().encode(name).length > 64)
    throw new AppError("invalidName");
  const unlockMs = unlock ? new Date(unlock).getTime() : 0;
  if (
    unlock &&
    (!Number.isFinite(unlockMs) ||
      Math.floor(unlockMs / 1000) <= Math.floor(now / 1000))
  )
    throw new AppError("unlockInPast");
  return {
    name,
    targetLamports: parseSol(target),
    unlockAt: BigInt(Math.floor(unlockMs / 1000)),
  };
}

export function newVaultId(): bigint {
  const parts = crypto.getRandomValues(new Uint32Array(2));
  return (BigInt(parts[0]) << 32n) | BigInt(parts[1]);
}

const knownErrors: [RegExp, MessageKey][] = [
  [/reject|declin|user.?cancel/i, "cancelled"],
  [/InsufficientVaultFunds/i, "insufficientVault"],
  [/VaultLocked/i, "vaultLocked"],
  [/VaultNotEmpty/i, "vaultNotEmpty"],
  [/InvalidAmount/i, "invalidAmount"],
  [/InvalidUnlockTime/i, "invalidUnlockChain"],
  [/InvalidVaultName/i, "invalidNameChain"],
  [/InvalidTargetAmount/i, "invalidTarget"],
  [
    /insufficient|no record of a prior credit|account.*not found/i,
    "insufficient",
  ],
  [
    /InstructionFallbackNotFound|InstructionDidNotDeserialize|DeclaredProgramIdMismatch/i,
    "programMismatch",
  ],
  [/fetch|ECONNREFUSED|failed to connect|network request/i, "rpc"],
];

export function errorMessage(error: unknown, locale: Locale = "en"): string {
  const messages: string[] = [];
  const logs: string[] = [];
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; current != null && depth < 8; depth++) {
    if (typeof current !== "object") {
      messages.push(String(current));
      break;
    }
    if (seen.has(current)) break;
    seen.add(current);
    const appError = readAppError(current);
    if (appError)
      return translate(
        locale,
        appError.key,
        appError.detail ? { detail: appError.detail } : undefined
      );
    const item = current as {
      message?: unknown;
      cause?: unknown;
      context?: { logs?: unknown; preflightData?: { logs?: unknown } };
    };
    if (typeof item.message === "string") messages.push(item.message);
    const entries = item.context?.logs ?? item.context?.preflightData?.logs;
    if (Array.isArray(entries))
      logs.push(
        ...entries.filter((line): line is string => typeof line === "string")
      );
    current = item.cause;
  }
  const text = [...messages, ...logs].join("\n");
  const match = knownErrors.find(([pattern]) => pattern.test(text));
  if (match) return translate(locale, match[1]);
  const detail = logs
    .filter((line) => /error|failed|insufficient/i.test(line))
    .slice(-4);
  return [
    ...new Set([messages[messages.length - 1] ?? String(error), ...detail]),
  ]
    .join("\n")
    .slice(0, 4000);
}
