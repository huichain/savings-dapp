import {
  useConnectedWallet,
  useConnect,
  useDisconnect,
  useWallets,
  useWalletStatus,
} from "@solana/kit-plugin-wallet/react";
import { useClient, useTrackedData } from "@solana/react";
import { useMemo } from "react";
import type { AppClient } from "../lib/client";
import { errorMessage, formatSol } from "../lib/amounts";
import { useLocale } from "../i18n/locale";

export function WalletPanel() {
  const client = useClient<AppClient>();
  const { t, locale } = useLocale();
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const status = useWalletStatus(client);
  const connect = useConnect(client);
  const disconnect = useDisconnect(client);
  const walletAddress = connected?.signer?.address;
  const balanceSpec = useMemo(
    () =>
      walletAddress
        ? {
            initialValueSource: client.rpc.getBalance(walletAddress, {
              commitment: "confirmed",
            }),
            initialValueMapper: (value: bigint) => value,
            streamSource: client.rpcSubscriptions.accountNotifications(
              walletAddress,
              { commitment: "confirmed" }
            ),
            streamValueMapper: ({ lamports }: { lamports: bigint }) => lamports,
          }
        : null,
    [client, walletAddress]
  );
  const balance = useTrackedData(balanceSpec);
  const waiting = status === "pending" || status === "reconnecting";
  return (
    <section className="panel wallet-panel" aria-label={t("walletLabel")}>
      <div>
        <span className="eyebrow">{t("walletLabel")}</span>
        <h2>{connected ? connected.wallet.name : t("walletTitle")}</h2>
        {connected ? (
          <>
            <p className="address">{connected.account.address}</p>
            <p>
              {balance.data
                ? `${formatSol(balance.data.value)} SOL`
                : t("balanceLoading")}
            </p>
          </>
        ) : (
          <p className="muted">{t("walletHint")}</p>
        )}
      </div>
      <div className="wallet-actions">
        {connected ? (
          <button
            className="secondary"
            disabled={disconnect.isRunning}
            onClick={() => disconnect.dispatch()}
          >
            {t("disconnect")}
          </button>
        ) : waiting ? (
          <p>{t("discovering")}</p>
        ) : wallets.length ? (
          wallets.map((wallet) => (
            <button
              key={wallet.name}
              disabled={connect.isRunning}
              onClick={() => connect.dispatch(wallet)}
            >
              {connect.isRunning
                ? t("connecting")
                : t("connectWallet", { name: wallet.name })}
            </button>
          ))
        ) : (
          <p className="muted">{t("noWallet")}</p>
        )}
      </div>
      {connect.error || disconnect.error || balance.error ? (
        <p className="error" role="alert">
          {errorMessage(
            connect.error || disconnect.error || balance.error,
            locale
          )}
        </p>
      ) : null}
    </section>
  );
}
