import { useState, type FormEvent } from "react";
import { useAction, useClient } from "@solana/react";
import { network, type AppClient } from "../lib/client";
import { prepareGoal, sendGoal } from "../lib/vaults";
import { errorMessage, formatSol } from "../lib/amounts";
import { AppError } from "../lib/errors";
import { useLocale } from "../i18n/locale";

export function CreateGoal({ onCreated }: { onCreated: () => void }) {
  const client = useClient<AppClient>();
  const { t, locale } = useLocale();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [unlock, setUnlock] = useState("");
  const [mode, setMode] = useState("flexible");
  const preview = useAction((signal: AbortSignal) =>
    prepareGoal(client, name, target, mode === "locked" ? unlock : "", signal)
  );
  const send = useAction(async (signal: AbortSignal) => {
    if (!preview.data) throw new AppError("previewRequired");
    const signature = await sendGoal(client, preview.data, signal);
    preview.reset();
    setName("");
    setTarget("");
    setUnlock("");
    onCreated();
    return signature;
  });
  const busy = preview.isRunning || send.isRunning;
  function changed() {
    preview.reset();
    send.reset();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    send.reset();
    preview.dispatch();
  }
  const dateLocale = locale === "zh" ? "zh-CN" : "en";
  return (
    <section className="panel create-panel">
      <span className="eyebrow">{t("createLabel")}</span>
      <h2>{t("createTitle")}</h2>
      <form onSubmit={submit}>
        <fieldset disabled={busy || !!preview.data}>
          <label>
            {t("name")}
            <input
              required
              value={name}
              onChange={(e) => {
                changed();
                setName(e.target.value);
              }}
              placeholder={t("namePlaceholder")}
            />
          </label>
          <p className="hint">
            {t("byteHint", { count: new TextEncoder().encode(name).length })}
          </p>
          <label>
            {t("amount")}
            <input
              required
              inputMode="decimal"
              value={target}
              onChange={(e) => {
                changed();
                setTarget(e.target.value);
              }}
              placeholder={t("amountPlaceholder")}
            />
          </label>
          <label>
            {t("mode")}
            <select
              value={mode}
              onChange={(e) => {
                changed();
                setMode(e.target.value);
              }}
            >
              <option value="flexible">{t("flexible")}</option>
              <option value="locked">{t("locked")}</option>
            </select>
          </label>
          {mode === "locked" && (
            <>
              <label>
                {t("unlockTime")}
                <input
                  required
                  type="datetime-local"
                  value={unlock}
                  onChange={(e) => {
                    changed();
                    setUnlock(e.target.value);
                  }}
                />
              </label>
              <p className="hint">{t("lockHint")}</p>
            </>
          )}
        </fieldset>
        {!preview.data && (
          <button className="full" disabled={busy} type="submit">
            {preview.isRunning ? t("simulating") : t("checkTx")}
          </button>
        )}
      </form>
      {preview.data && (
        <div className="preview" aria-live="polite">
          <h3>{t("previewTitle")}</h3>
          <dl>
            <dt>{t("networkLabel")}</dt>
            <dd>{network.label}</dd>
            <dt>{t("goalLabel")}</dt>
            <dd>
              {preview.data.goal.name} ·{" "}
              {formatSol(preview.data.goal.targetLamports)} SOL
            </dd>
            <dt>{t("modeLabel")}</dt>
            <dd>
              {preview.data.goal.unlockAt === 0n
                ? t("flexibleShort")
                : t("lockedUntil", {
                    time: new Date(
                      Number(preview.data.goal.unlockAt) * 1000
                    ).toLocaleString(dateLocale),
                  })}
            </dd>
            <dt>{t("rent")}</dt>
            <dd>{formatSol(preview.data.rent)} SOL</dd>
            <dt>{t("fee")}</dt>
            <dd>{formatSol(preview.data.fee)} SOL</dd>
            <dt>{t("payer")}</dt>
            <dd className="address">{preview.data.authority}</dd>
            <dt>{t("vaultAddress")}</dt>
            <dd className="address">{preview.data.vault}</dd>
          </dl>
          <p className="hint">{t("previewNote")}</p>
          <div className="row">
            <button disabled={busy} onClick={() => send.dispatch()}>
              {send.isRunning ? t("waitingWallet") : t("confirm")}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                preview.reset();
                send.reset();
              }}
            >
              {t("back")}
            </button>
          </div>
        </div>
      )}
      {preview.error || send.error ? (
        <p className="error" role="alert">
          {errorMessage(preview.error || send.error, locale)}
        </p>
      ) : null}
      {send.data && (
        <p className="success" role="status">
          {t("created")}{" "}
          <span className="address">{t("tx", { signature: send.data })}</span>
        </p>
      )}
    </section>
  );
}
