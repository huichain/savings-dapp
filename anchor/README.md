# savings-vault

Anchor program for multiple SOL savings vaults. Rules are enforced on-chain. Tests use LiteSVM and do not need a wallet or a public cluster.

## Rules

- One wallet can create many vaults, distinguished by `vault_id: u64`. An open id cannot be reused. A closed id can.
- `name` must contain non-whitespace text and be at most 64 UTF-8 bytes.
- `target_lamports` must be greater than zero. It is a display target only. Deposits may exceed it, and a flexible vault can be withdrawn before the target is reached.
- `unlock_at = 0` is flexible. Any other value must be a positive Unix timestamp strictly after the clock at creation.
- A locked vault accepts deposits, but withdraw and close wait until `Clock::get()?.unix_timestamp >= unlock_at`. Reaching the target does not unlock it.
- Name, target, id, authority, and unlock time cannot be changed. There is no early-unlock or admin withdraw instruction.
- Only the vault authority can deposit, withdraw, or close through this program. A direct system transfer to the PDA can still increase its balance. That transfer does not emit a deposit event and does not bypass the lock.
- The withdrawable amount is the account lamports minus the current rent reserve. Close is allowed only when that amount is zero and the vault is unlocked. Close returns the remaining lamports to the authority.

## Accounts

Amounts are lamports. `1 SOL = 1_000_000_000` lamports.

PDA seeds: `[b"vault", authority (32 bytes), vault_id (u64 little-endian)]`.

Fields, in order: `authority: Pubkey`, `vault_id: u64`, `name: String`, `target_lamports: u64`, `created_at: i64`, `unlock_at: i64`. The account is allocated `8 + Vault::INIT_SPACE` bytes (140, including the discriminator). The SOL balance is the account lamports, not a stored field.

| Instruction | Accounts |
| --- | --- |
| `initialize_vault` | authority (writable signer), vault (writable), system program |
| `deposit` | authority (writable signer), vault (writable), system program |
| `withdraw`, `close_vault` | authority (writable signer), vault (writable) |

Successful calls emit `VaultCreated`, `VaultDeposited`, `VaultWithdrawn`, or `VaultClosed`. Deposit and withdraw events include the amount, the withdrawable balance after the call, and the clock. The close event includes the returned lamports. Events come from logs and can be truncated by RPC. Display balances from the account, and only after the transaction succeeds.

## Build and test

Requires Anchor CLI 1.1.2, Rust 1.89.0, and the Solana CLI on `PATH`. From `anchor/`:

```bash
NO_DNA=1 anchor build --ignore-keys
cargo test --workspace --locked
```

Build before test. The tests load `target/deploy/savings_vault.so` with `include_bytes!`. The build also writes `target/idl/savings_vault.json`.

## Deploy

`Anchor.toml`, the IDL, and the generated client use `HDrUXhCBtQZVWFsz7v6qqo1wncJppuMsnSA5rtwfnRp1`. That address is the public key of this project's `target/deploy/savings_vault-keypair.json`. Confirm it before deploying, and do not deploy with another program's keypair.

```bash
solana-keygen pubkey target/deploy/savings_vault-keypair.json
solana program deploy target/deploy/savings_vault.so \
  --program-id target/deploy/savings_vault-keypair.json \
  --url devnet
```

The fee payer is the Solana CLI wallet. Deployment spends Devnet SOL. The program account keeps a rent-exempt balance. A failed deploy can leave that rent in a buffer account; close the buffer with `solana program close <BUFFER> --url devnet --bypass-warning` to return it. Rebuilding does not deploy.
