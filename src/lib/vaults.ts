import {
  createClient,
  type TransactionSigner,
  getAddressEncoder,
  getBase64Decoder,
  compileTransaction,
  estimateAndSetResourceLimitsFactory,
  estimateResourceLimitsFactory,
  getTransactionMessageComputeUnitLimit,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageLifetimeUsingBlockhash,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getBase58Decoder,
  getCompiledTransactionMessageEncoder,
  compileTransactionMessage,
  type Address,
  type Instruction,
  type Base58EncodedBytes,
  type TransactionMessageBytesBase64,
} from "@solana/kit";
import {
  findVaultPda,
  getCloseVaultInstruction,
  getDepositInstruction,
  getInitializeVaultInstructionAsync,
  getVaultDecoder,
  getWithdrawInstruction,
  SAVINGS_VAULT_PROGRAM_ADDRESS,
  VAULT_DISCRIMINATOR,
  type Vault,
} from "../generated/savings-vault";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { network, type AppClient } from "./client";
import { newVaultId, parseGoal, parseSol } from "./amounts";
import { AppError } from "./errors";
import idl from "../../anchor/target/idl/savings_vault.json" with { type: "json" };

const vaultSpace = idl.constants.find((item) => item.name === "VAULT_SPACE");
if (!vaultSpace || vaultSpace.type !== "u64") {
  throw new Error("IDL is missing VAULT_SPACE");
}
export const VAULT_SPACE = BigInt(vaultSpace.value);
export type Goal = Vault & {
  address: Address;
  /** Lamports that can be withdrawn. Excludes the rent reserve. */
  available: bigint;
  /** Rent-exempt lamports that must stay in the account. */
  reserve: bigint;
};

export async function loadGoals(
  client: AppClient,
  authority: Address,
  abortSignal: AbortSignal
) {
  const [accounts, rent, balance, slot, program] = await Promise.all([
    client.rpc
      .getProgramAccounts(SAVINGS_VAULT_PROGRAM_ADDRESS, {
        commitment: "confirmed",
        encoding: "base64",
        withContext: true,
        filters: [
          { dataSize: VAULT_SPACE },
          {
            memcmp: {
              offset: 8n,
              bytes: getBase58Decoder().decode(
                getAddressEncoder().encode(authority)
              ) as Base58EncodedBytes,
              encoding: "base58",
            },
          },
        ],
      })
      .send({ abortSignal }),
    client.rpc
      .getMinimumBalanceForRentExemption(VAULT_SPACE)
      .send({ abortSignal }),
    client.rpc
      .getBalance(authority, { commitment: "confirmed" })
      .send({ abortSignal }),
    client.rpc.getSlot({ commitment: "confirmed" }).send({ abortSignal }),
    client.rpc
      .getAccountInfo(SAVINGS_VAULT_PROGRAM_ADDRESS, {
        encoding: "base64",
        commitment: "confirmed",
      })
      .send({ abortSignal }),
  ]);
  if (!program.value?.executable) throw new AppError("programMissing");
  const chainTime = await client.rpc.getBlockTime(slot).send({ abortSignal });
  const goals = await Promise.all(
    accounts.value.map(async ({ pubkey, account }): Promise<Goal> => {
      const bytes = getBase64Encoder().encode(account.data[0]);
      if (
        account.owner !== SAVINGS_VAULT_PROGRAM_ADDRESS ||
        BigInt(bytes.length) !== VAULT_SPACE ||
        !VAULT_DISCRIMINATOR.every((byte, i) => bytes[i] === byte)
      )
        throw new AppError("vaultCheck");
      const vault = getVaultDecoder().decode(bytes);
      const [expected] = await findVaultPda({
        authority,
        vaultId: vault.vaultId,
      });
      if (
        vault.authority !== authority ||
        expected !== pubkey ||
        !vault.name.trim() ||
        new TextEncoder().encode(vault.name).length > 64 ||
        vault.targetLamports <= 0n ||
        vault.unlockAt < 0n
      )
        throw new AppError("vaultData");
      return {
        ...vault,
        address: pubkey,
        reserve: rent,
        available: account.lamports > rent ? account.lamports - rent : 0n,
      };
    })
  );
  return {
    goals: goals.sort((a, b) =>
      a.createdAt === b.createdAt
        ? a.address.localeCompare(b.address)
        : a.createdAt > b.createdAt
          ? -1
          : 1
    ),
    balance: balance.value,
    chainTime,
  };
}

async function connectedWallet(client: AppClient) {
  const connected = client.wallet.getState().connected;
  const signer = connected?.signer;
  if (!connected || !signer) throw new AppError("needSigner");
  if (!connected.account.chains.includes(network.chain))
    throw new AppError("switchDevnet");
  const version = connected.supportedTransactionVersions.has(1) ? 1 : 0;
  if (!connected.supportedTransactionVersions.has(version))
    throw new AppError("walletVersion");
  return { signer, version: version as 0 | 1 };
}

async function planInstruction(
  client: AppClient,
  instruction: Instruction,
  abortSignal: AbortSignal
) {
  const { signer, version } = await connectedWallet(client);
  // Both clients share the same wallet signer and configured RPC; older wallets use v0.
  const planner = version === 1 ? client : createV0Client(signer);
  const [planned, lifetime] = await Promise.all([
    planner.planTransaction([instruction], { abortSignal }),
    client.rpc
      .getLatestBlockhash({ commitment: "confirmed" })
      .send({ abortSignal }),
  ]);
  const estimate = estimateAndSetResourceLimitsFactory(
    estimateResourceLimitsFactory({ rpc: client.rpc })
  );
  const estimatedMessage = await estimate(
    setTransactionMessageLifetimeUsingBlockhash(lifetime.value, planned),
    { abortSignal }
  );
  // Simulation omits the compute-budget overhead, so the exact consumed value fails on chain.
  const estimatedUnits =
    getTransactionMessageComputeUnitLimit(estimatedMessage);
  const message =
    estimatedUnits === undefined
      ? estimatedMessage
      : setTransactionMessageComputeUnitLimit(
          Math.min(
            1_400_000,
            estimatedUnits + Math.max(300, Math.ceil(estimatedUnits * 0.1))
          ),
          estimatedMessage
        );
  const transaction = compileTransaction(message);
  const encoded = getBase64EncodedWireTransaction(transaction);
  const [simulation, fee] = await Promise.all([
    client.rpc
      .simulateTransaction(encoded, {
        encoding: "base64",
        commitment: "confirmed",
        sigVerify: false,
      })
      .send({ abortSignal }),
    client.rpc
      .getFeeForMessage(
        getBase64Decoder().decode(
          getCompiledTransactionMessageEncoder().encode(
            compileTransactionMessage(message)
          )
        ) as TransactionMessageBytesBase64,
        { commitment: "confirmed" }
      )
      .send({ abortSignal }),
  ]);
  if (simulation.value.err)
    throw new AppError(
      "simulationFailed",
      JSON.stringify(simulation.value.err)
    );
  if (fee.value === null) throw new AppError("feeExpired");
  return {
    message,
    authority: signer.address,
    fee: fee.value,
    version,
    units: simulation.value.unitsConsumed,
    preparedAt: Date.now(),
  };
}

export async function prepareGoal(
  client: AppClient,
  name: string,
  target: string,
  unlock: string,
  abortSignal: AbortSignal
) {
  const goal = parseGoal(name, target, unlock);
  const ix = await getInitializeVaultInstructionAsync({
    ...goal,
    authority: (await connectedWallet(client)).signer,
    vaultId: newVaultId(),
  });
  const [planned, rent] = await Promise.all([
    planInstruction(client, ix, abortSignal),
    client.rpc
      .getMinimumBalanceForRentExemption(VAULT_SPACE)
      .send({ abortSignal }),
  ]);
  return {
    ...planned,
    goal,
    vault: ix.accounts[1].address,
    rent,
  };
}

function assertUnlocked(goal: Goal, chainTime: bigint | null) {
  if (goal.unlockAt > 0n && (chainTime === null || chainTime < goal.unlockAt))
    throw new AppError("vaultLocked");
}

export async function prepareVaultAction(
  client: AppClient,
  goal: Goal,
  action: { kind: "deposit" | "withdraw"; amount: string } | { kind: "close" },
  chainTime: bigint | null,
  abortSignal: AbortSignal
) {
  const { signer } = await connectedWallet(client);
  if (signer.address !== goal.authority) throw new AppError("walletChanged");
  let amount = 0n;
  let instruction: Instruction;
  if (action.kind === "deposit") {
    amount = parseSol(action.amount);
    instruction = getDepositInstruction({
      authority: signer,
      vault: goal.address,
      amount,
    });
  } else if (action.kind === "withdraw") {
    assertUnlocked(goal, chainTime);
    amount = parseSol(action.amount);
    if (amount > goal.available) throw new AppError("withdrawExceeds");
    instruction = getWithdrawInstruction({
      authority: signer,
      vault: goal.address,
      amount,
    });
  } else {
    assertUnlocked(goal, chainTime);
    if (goal.available !== 0n) throw new AppError("vaultNotEmpty");
    amount = goal.reserve;
    instruction = getCloseVaultInstruction({
      authority: signer,
      vault: goal.address,
    });
  }
  const planned = await planInstruction(client, instruction, abortSignal);
  return { ...planned, kind: action.kind, amount, vault: goal.address };
}

function createV0Client(signer: TransactionSigner) {
  return createClient()
    .use((client) => ({ ...client, payer: signer, identity: signer }))
    .use(
      solanaRpc({
        rpcUrl: network.rpcUrl,
        rpcSubscriptionsUrl: network.wsUrl,
        transactionConfig: { version: 0 },
      })
    );
}

export type GoalPreview = Awaited<ReturnType<typeof prepareGoal>>;
export type VaultActionPreview = Awaited<ReturnType<typeof prepareVaultAction>>;

export async function sendGoal(
  client: AppClient,
  preview: GoalPreview | VaultActionPreview,
  abortSignal: AbortSignal
) {
  const connected = client.wallet.getState().connected;
  if (!connected?.signer || connected.signer.address !== preview.authority)
    throw new AppError("walletChanged");
  if (
    !connected.account.chains.includes(network.chain) ||
    !connected.supportedTransactionVersions.has(preview.version)
  )
    throw new AppError("walletNetworkChanged");
  if (Date.now() - preview.preparedAt > 30_000)
    throw new AppError("previewExpired");
  const sender =
    preview.version === 1 ? client : createV0Client(connected.signer);
  const result = await sender.sendTransaction(preview.message, { abortSignal });
  return result.context.signature;
}
