# Savings

A Devnet app for multiple SOL savings goals. The Anchor program enforces the rules. The React app connects a wallet, creates a goal, and can deposit, withdraw, and close that wallet's vaults.

Program ID: `HDrUXhCBtQZVWFsz7v6qqo1wncJppuMsnSA5rtwfnRp1`

## Requirements

Node.js 22.18+, Anchor CLI 1.1.2, Rust 1.89.0, and the Solana CLI. Run commands from this directory.

## Run

```bash
npm install
npm run setup
npm run dev
```

`setup` builds the program and regenerates `src/generated/savings-vault`. It does not deploy.

Open the printed local URL. The page defaults to English; use the language switch for Chinese. In Phantom, enable testnet mode and select Solana Devnet, then connect. Request test SOL with:

```bash
solana airdrop 2 <WALLET_ADDRESS> --url devnet
```

Creating a goal pays account rent and a transaction fee. It does not deposit the target amount. A locked goal cannot be changed or withdrawn before its unlock time.

## Checks

```bash
npm test
npm run build
npm run lint
npm run anchor-test
```

`anchor-test` builds first. The LiteSVM tests load `anchor/target/deploy/savings_vault.so`.

## Layout

- `src/` — React UI
- `src/generated/savings-vault/` — client generated from the IDL; do not edit by hand
- `anchor/programs/savings-vault/` — program and tests

Program rules, accounts, and deployment are in [anchor/README.md](anchor/README.md).
