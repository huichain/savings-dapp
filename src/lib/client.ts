import { createClient } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { walletSigner } from "@solana/kit-plugin-wallet";

export const network = {
  label: "Devnet",
  chain: "solana:devnet",
  rpcUrl: "https://api.devnet.solana.com",
  wsUrl: "wss://api.devnet.solana.com",
} as const;

export const client = createClient()
  .use(walletSigner({ chain: network.chain }))
  .use(
    solanaRpc({
      rpcUrl: network.rpcUrl,
      rpcSubscriptionsUrl: network.wsUrl,
      transactionConfig: { version: 1 },
    })
  );

export type AppClient = typeof client;
