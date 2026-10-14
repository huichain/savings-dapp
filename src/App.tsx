import { useCallback } from "react";
import { address } from "@solana/kit";
import {
  useConnectedWallet,
  WalletReadyGate,
} from "@solana/kit-plugin-wallet/react";
import { useClient, useRequest } from "@solana/react";
import { WalletPanel } from "./components/WalletPanel";
import { CreateGoal } from "./components/CreateGoal";
import { GoalCard } from "./components/GoalCard";
import { network, type AppClient } from "./lib/client";
import { loadGoals } from "./lib/vaults";
import { errorMessage } from "./lib/amounts";
import { LanguageSwitch, useLocale } from "./i18n/locale";

function Goals({ authority }: { authority: string }) {
  const client = useClient<AppClient>();
  const { t, locale } = useLocale();
  const query = useCallback(
    (signal: AbortSignal) => loadGoals(client, address(authority), signal),
    [client, authority]
  );
  const { data, error, status, refresh } = useRequest(query, {
    getAbortSignal: () => AbortSignal.timeout(10_000),
  });
  return (
    <div className="workspace">
      <CreateGoal onCreated={refresh} />
      <section aria-label={t("goalsLabel")}>
        <div className="row section-heading">
          <div>
            <span className="eyebrow">{t("goalsLabel")}</span>
            <h2>
              {t("myGoals", { count: data ? ` · ${data.goals.length}` : "" })}
            </h2>
          </div>
          <button
            className="secondary"
            onClick={() => refresh()}
            disabled={status === "fetching"}
          >
            {status === "fetching" ? t("refreshing") : t("refresh")}
          </button>
        </div>
        {error ? (
          <div className="panel error" role="alert">
            {errorMessage(error, locale)}
          </div>
        ) : null}
        {!data && status === "fetching" && (
          <div className="panel muted" role="status">
            {t("loadingGoals")}
          </div>
        )}
        {data?.goals.length === 0 && (
          <div className="panel empty">
            <h3>{t("emptyTitle")}</h3>
            <p className="muted">{t("emptyBody")}</p>
          </div>
        )}
        <div className="goals">
          {data?.goals.map((goal) => (
            <GoalCard
              key={goal.address}
              goal={goal}
              chainTime={data.chainTime}
              onChanged={refresh}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const client = useClient<AppClient>();
  const connected = useConnectedWallet(client);
  const { t } = useLocale();
  return (
    <main className="shell">
      <header>
        <div className="row">
          <span className="brand">{t("brand")}</span>
          <div className="header-actions">
            <LanguageSwitch />
            <span className="network">
              <span />
              {network.label}
            </span>
          </div>
        </div>
        <h1>{t("pageTitle")}</h1>
        <p className="intro">{t("pageIntro")}</p>
      </header>
      <WalletReadyGate
        client={client}
        fallback={
          <section className="panel" role="status">
            {t("discovering")}
          </section>
        }
      >
        <WalletPanel />
        {connected ? (
          <Goals
            key={connected.account.address}
            authority={connected.account.address}
          />
        ) : (
          <section className="panel empty">
            <h2>{t("connectPromptTitle")}</h2>
            <p className="muted">{t("connectPromptBody")}</p>
          </section>
        )}
      </WalletReadyGate>
      <footer>{t("footer")}</footer>
    </main>
  );
}
