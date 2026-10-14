import { useState } from "react";
import { useAction, useClient } from "@solana/react";
import type { AppClient } from "../lib/client";
import { errorMessage, formatSol } from "../lib/amounts";
import { AppError } from "../lib/errors";
import {
  prepareVaultAction,
  sendGoal,
  type Goal,
  type VaultActionPreview,
} from "../lib/vaults";
import { useLocale } from "../i18n/locale";

type ActionKind = "deposit" | "withdraw" | "close";

export function GoalActions({
  goal,
  chainTime,
  locked,
  onChanged,
}: {
  goal: Goal;
  chainTime: bigint | null;
  locked: boolean;
  onChanged: () => void;
}) {
  const client = useClient<AppClient>();
  const { t, locale } = useLocale();
  const [kind, setKind] = useState<ActionKind | null>(null);
  const [amount, setAmount] = useState("");
  const preview = useAction((signal: AbortSignal) => {
    if (!kind) throw new AppError("previewRequired");
    return prepareVaultAction(
      client,
      goal,
      kind === "close" ? { kind } : { kind, amount },
      chainTime,
      signal
    );
  });
  const send = useAction(async (signal: AbortSignal) => {
    if (!preview.data) throw new AppError("previewRequired");
    const signature = await sendGoal(client, preview.data, signal);
    preview.reset();
    setKind(null);
    setAmount("");
    onChanged();
    return signature;
  });
  const busy = preview.isRunning || send.isRunning;

  function choose(next: ActionKind) {
    preview.reset();
    send.reset();
    setAmount("");
    setKind(next);
  }

  const shown = preview.data;
  return (
    <div className="goal-actions">
      {locked ? <p className="hint">{t("lockedNoExit")}</p> : null}
      <div className="row">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => choose("deposit")}
        >
          {t("deposit")}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || locked || goal.available === 0n}
          onClick={() => choose("withdraw")}
        >
          {t("withdraw")}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || locked || goal.available !== 0n}
          onClick={() => choose("close")}
        >
          {t("closeVault")}
        </button>
      </div>
      {kind && !shown && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send.reset();
            preview.dispatch();
          }}
        >
          {kind !== "close" && (
            <label>
              {t("solAmount")}
              <input
                required
                inputMode="decimal"
                value={amount}
                disabled={busy}
                onChange={(event) => {
                  preview.reset();
                  send.reset();
                  setAmount(event.target.value);
                }}
                placeholder={t("amountPlaceholder")}
              />
            </label>
          )}
          {kind === "withdraw" && goal.available > 0n && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                preview.reset();
                send.reset();
                setAmount(formatSol(goal.available));
              }}
            >
              {t("withdrawAll")}
            </button>
          )}
          <p className="hint">{t(noteKey(kind))}</p>
          <button className="full" disabled={busy} type="submit">
            {preview.isRunning ? t("simulating") : t("checkTx")}
          </button>
        </form>
      )}
      {shown && (
        <ActionPreview
          preview={shown}
          busy={busy}
          onConfirm={() => send.dispatch()}
          onBack={() => {
            preview.reset();
            send.reset();
          }}
        />
      )}
      {preview.error || send.error ? (
        <p className="error" role="alert">
          {errorMessage(preview.error || send.error, locale)}
        </p>
      ) : null}
      {send.data && (
        <p className="success" role="status">
          {t("actionConfirmed")}{" "}
          <span className="address">{t("tx", { signature: send.data })}</span>
        </p>
      )}
    </div>
  );
}

function noteKey(kind: ActionKind) {
  if (kind === "deposit") return "depositNote" as const;
  if (kind === "withdraw") return "withdrawNote" as const;
  return "closeNote" as const;
}

function ActionPreview({
  preview,
  busy,
  onConfirm,
  onBack,
}: {
  preview: VaultActionPreview;
  busy: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const { t } = useLocale();
  const label =
    preview.kind === "close"
      ? t("returnedRent")
      : preview.kind === "deposit"
        ? t("deposit")
        : t("withdraw");
  return (
    <div className="preview" aria-live="polite">
      <h3>{t("previewTitle")}</h3>
      <dl>
        <dt>{label}</dt>
        <dd>{formatSol(preview.amount)} SOL</dd>
        <dt>{t("fee")}</dt>
        <dd>{formatSol(preview.fee)} SOL</dd>
      </dl>
      <p className="hint">{t(noteKey(preview.kind))}</p>
      <div className="row">
        <button type="button" disabled={busy} onClick={onConfirm}>
          {busy ? t("waitingWallet") : t("confirm")}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onBack}
        >
          {t("back")}
        </button>
      </div>
    </div>
  );
}
