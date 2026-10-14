use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

struct Fixture {
    svm: LiteSVM,
    // A separate wallet pays fees so user balances only change by deposits, withdrawals, and rent.
    fee_payer: Keypair,
    alice: Keypair,
    bob: Keypair,
    logs: Vec<String>,
}

impl Fixture {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program(
            savings_vault::id(),
            include_bytes!(concat!(
                env!("CARGO_TARGET_TMPDIR"),
                "/../deploy/savings_vault.so"
            )),
        )
        .unwrap();
        let fee_payer = Keypair::new();
        let alice = Keypair::new();
        let bob = Keypair::new();
        for wallet in [&fee_payer, &alice, &bob] {
            svm.airdrop(&wallet.pubkey(), 1_000_000_000).unwrap();
        }
        Self {
            svm,
            fee_payer,
            alice,
            bob,
            logs: Vec::new(),
        }
    }

    fn send(&mut self, as_bob: bool, ix: Instruction) -> Result<(), String> {
        let authority = if as_bob { &self.bob } else { &self.alice };
        // Expire the blockhash so the same instruction can be sent again.
        self.svm.expire_blockhash();
        let message = Message::new_with_blockhash(
            &[ix],
            Some(&self.fee_payer.pubkey()),
            &self.svm.latest_blockhash(),
        );
        let tx = VersionedTransaction::try_new(
            VersionedMessage::Legacy(message),
            &[&self.fee_payer, authority],
        )
        .unwrap();
        self.logs.clear();
        let meta = self
            .svm
            .send_transaction(tx)
            .map_err(|e| format!("{e:?}"))?;
        self.logs = meta.logs;
        Ok(())
    }

    fn balance(&self, address: Pubkey) -> u64 {
        self.svm.get_balance(&address).unwrap()
    }

    fn initialize(&mut self, as_bob: bool) -> Pubkey {
        self.initialize_goal(as_bob, 0, "我的储蓄罐", 1_000_000, 0)
            .unwrap()
    }

    fn set_time(&mut self, timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = timestamp;
        self.svm.set_sysvar(&clock);
    }

    fn initialize_goal(
        &mut self,
        as_bob: bool,
        vault_id: u64,
        name: &str,
        target_lamports: u64,
        unlock_at: i64,
    ) -> Result<Pubkey, String> {
        let authority = if as_bob {
            self.bob.pubkey()
        } else {
            self.alice.pubkey()
        };
        let vault = vault_pda(authority, vault_id);
        let ix = instruction(
            savings_vault::instruction::InitializeVault {
                vault_id,
                name: name.into(),
                target_lamports,
                unlock_at,
            }
            .data(),
            savings_vault::accounts::InitializeVault {
                authority,
                vault,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        self.send(as_bob, ix)?;
        Ok(vault)
    }
}

fn vault_pda(authority: Pubkey, vault_id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[
            savings_vault::constants::VAULT_SEED,
            authority.as_ref(),
            &vault_id.to_le_bytes(),
        ],
        &savings_vault::id(),
    )
    .0
}

fn instruction(
    data: Vec<u8>,
    accounts: Vec<anchor_lang::solana_program::instruction::AccountMeta>,
) -> Instruction {
    Instruction::new_with_bytes(savings_vault::id(), &data, accounts)
}

fn deposit(authority: Pubkey, vault: Pubkey, amount: u64) -> Instruction {
    instruction(
        savings_vault::instruction::Deposit { amount }.data(),
        savings_vault::accounts::Deposit {
            authority,
            vault,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn withdraw(authority: Pubkey, vault: Pubkey, amount: u64) -> Instruction {
    instruction(
        savings_vault::instruction::Withdraw { amount }.data(),
        savings_vault::accounts::Withdraw { authority, vault }.to_account_metas(None),
    )
}

fn close(authority: Pubkey, vault: Pubkey) -> Instruction {
    instruction(
        savings_vault::instruction::CloseVault {}.data(),
        savings_vault::accounts::CloseVault { authority, vault }.to_account_metas(None),
    )
}

fn assert_error(result: Result<(), String>, expected: savings_vault::error::ErrorCode) {
    let err = result.expect_err("transaction must fail");
    let code: u32 = expected.into();
    assert!(
        err.contains(&format!("Custom({code})")),
        "unexpected error: {err}"
    );
}

#[test]
fn independent_vaults_and_exact_deposit_withdraw_balances() {
    let mut f = Fixture::new();
    let alice = f.alice.pubkey();
    let bob = f.bob.pubkey();
    let alice_vault = f.initialize(false);
    let bob_vault = f.initialize(true);
    assert_ne!(alice_vault, bob_vault);

    let account = f.svm.get_account(&alice_vault).unwrap();
    assert_eq!(account.owner, savings_vault::id());
    let state = savings_vault::state::Vault::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(state.authority, alice);
    let reserve = account.lamports;
    let bob_vault_before = f.balance(bob_vault);
    let bob_before = f.balance(bob);
    let before = f.balance(alice);

    f.send(false, deposit(alice, alice_vault, 100_000)).unwrap();
    assert_eq!(f.balance(alice_vault), reserve + 100_000);
    assert_eq!(f.balance(alice), before - 100_000);

    f.send(false, withdraw(alice, alice_vault, 40_000)).unwrap();
    assert_eq!(f.balance(alice_vault), reserve + 60_000);
    assert_eq!(f.balance(alice), before - 60_000);

    f.send(false, withdraw(alice, alice_vault, 60_000)).unwrap();
    assert_eq!(f.balance(alice_vault), reserve);
    assert_eq!(f.balance(alice), before);
    assert_eq!(f.balance(bob_vault), bob_vault_before);
    assert_eq!(f.balance(bob), bob_before);
}

#[test]
fn other_wallet_cannot_deposit_withdraw_or_close() {
    let mut f = Fixture::new();
    let vault = f.initialize(false);
    let alice = f.alice.pubkey();
    let bob = f.bob.pubkey();
    f.send(false, deposit(alice, vault, 100_000)).unwrap();
    let before = f.balance(vault);
    let alice_before = f.balance(alice);
    let bob_before = f.balance(bob);
    for ix in [
        deposit(bob, vault, 1),
        withdraw(bob, vault, 1),
        close(bob, vault),
    ] {
        assert_error(
            f.send(true, ix),
            savings_vault::error::ErrorCode::VaultUnauthorized,
        );
        assert_eq!(f.balance(vault), before);
        assert_eq!(f.balance(alice), alice_before);
        assert_eq!(f.balance(bob), bob_before);
    }
}

#[test]
fn invalid_amounts_and_rent_withdrawal_leave_balances_unchanged() {
    use savings_vault::error::ErrorCode;
    let mut f = Fixture::new();
    let vault = f.initialize(false);
    let alice = f.alice.pubkey();
    let reserve = f.balance(vault);
    let before = f.balance(alice);
    assert_error(
        f.send(false, deposit(alice, vault, 0)),
        ErrorCode::InvalidAmount,
    );
    assert_error(
        f.send(false, withdraw(alice, vault, 0)),
        ErrorCode::InvalidAmount,
    );
    assert_error(
        f.send(false, withdraw(alice, vault, 1)),
        ErrorCode::InsufficientVaultFunds,
    );
    assert_eq!(f.balance(vault), reserve);
    assert_eq!(f.balance(alice), before);

    f.send(false, deposit(alice, vault, 100_000)).unwrap();
    for amount in [100_001, reserve + 100_000, u64::MAX] {
        assert_error(
            f.send(false, withdraw(alice, vault, amount)),
            ErrorCode::InsufficientVaultFunds,
        );
        assert_eq!(f.balance(vault), reserve + 100_000);
        assert_eq!(f.balance(alice), before - 100_000);
    }
}

#[test]
fn close_requires_empty_vault_and_returns_exact_reserve() {
    let mut f = Fixture::new();
    let alice = f.alice.pubkey();
    let before_initialize = f.balance(alice);
    let vault = f.initialize(false);
    let reserve = f.balance(vault);
    f.send(false, deposit(alice, vault, 100_000)).unwrap();
    // Close is rejected while withdrawable lamports remain.
    assert_error(
        f.send(false, close(alice, vault)),
        savings_vault::error::ErrorCode::VaultNotEmpty,
    );
    assert_eq!(f.balance(vault), reserve + 100_000);
    f.send(false, withdraw(alice, vault, 100_000)).unwrap();
    let before_close = f.balance(alice);
    f.send(false, close(alice, vault)).unwrap();
    assert!(f.svm.get_account(&vault).is_none());
    assert_eq!(f.balance(alice), before_close + reserve);
    assert_eq!(f.balance(alice), before_initialize);
}

fn read_vault(f: &Fixture, vault: Pubkey) -> savings_vault::state::Vault {
    let account = f.svm.get_account(&vault).unwrap();
    savings_vault::state::Vault::try_deserialize(&mut account.data.as_slice()).unwrap()
}

fn event<T: anchor_lang::Event + anchor_lang::AnchorDeserialize>(f: &Fixture) -> T {
    use base64::Engine;
    let events: Vec<_> = f
        .logs
        .iter()
        .filter_map(|log| log.strip_prefix("Program data: "))
        .map(|encoded| {
            base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .unwrap()
        })
        .filter(|data| data.starts_with(T::DISCRIMINATOR))
        .collect();
    assert_eq!(events.len(), 1, "expected one matching event: {:?}", f.logs);
    T::deserialize(&mut &events[0][T::DISCRIMINATOR.len()..]).unwrap()
}

#[test]
fn multiple_goals_store_metadata_and_isolate_balances() {
    let mut f = Fixture::new();
    f.set_time(1_000);
    let alice = f.alice.pubkey();
    let first = f.initialize_goal(false, 7, "旅行", 100, 0).unwrap();
    let state = read_vault(&f, first);
    assert_eq!(state.authority, alice);
    assert_eq!(state.vault_id, 7);
    assert_eq!(state.name, "旅行");
    assert_eq!(state.target_lamports, 100);
    assert_eq!(state.created_at, 1_000);
    assert_eq!(state.unlock_at, 0);
    let created: savings_vault::VaultCreated = event(&f);
    assert_eq!(created.vault, first);
    assert_eq!(created.authority, alice);
    assert_eq!(created.vault_id, 7);
    assert_eq!(created.name, "旅行");
    assert_eq!(created.target_lamports, 100);
    assert_eq!(created.created_at, 1_000);
    assert_eq!(created.unlock_at, 0);

    let second = f
        .initialize_goal(false, u64::MAX, "电脑", 200, 2_000)
        .unwrap();
    let bob_goal = f.initialize_goal(true, 7, "Bob", 100, 0).unwrap();
    assert_ne!(first, second);
    assert_ne!(first, bob_goal);
    let first_reserve = f.balance(first);
    let second_reserve = f.balance(second);
    let bob_reserve = f.balance(bob_goal);
    // The target is display-only: deposits may exceed it, and a flexible vault can be withdrawn early.
    f.send(false, deposit(alice, first, 150)).unwrap();
    f.send(false, deposit(alice, second, 50)).unwrap();
    f.send(false, withdraw(alice, first, 100)).unwrap();
    assert_eq!(f.balance(first), first_reserve + 50);
    assert_eq!(f.balance(second), second_reserve + 50);
    assert_eq!(f.balance(bob_goal), bob_reserve);
    assert_eq!(read_vault(&f, first).target_lamports, 100);
    assert_eq!(read_vault(&f, second).unlock_at, 2_000);
    let before = f.balance(first);
    assert!(f.initialize_goal(false, 7, "覆盖", 1, 0).is_err());
    assert_eq!(f.balance(first), before);
    assert_eq!(read_vault(&f, first).name, "旅行");
}

#[test]
fn rejects_invalid_goal_parameters_atomically() {
    use savings_vault::error::ErrorCode;
    let mut f = Fixture::new();
    f.set_time(1_000);
    let alice = f.alice.pubkey();
    let before = f.balance(alice);
    let long_ascii = "a".repeat(65);
    let long_unicode = "储".repeat(22); // 66 UTF-8 bytes
    for (name, target, unlock, error) in [
        ("", 1, 0, ErrorCode::InvalidVaultName),
        (" \t\n", 1, 0, ErrorCode::InvalidVaultName),
        (long_ascii.as_str(), 1, 0, ErrorCode::InvalidVaultName),
        (long_unicode.as_str(), 1, 0, ErrorCode::InvalidVaultName),
        ("有效", 0, 0, ErrorCode::InvalidTargetAmount),
        ("有效", 1, -1, ErrorCode::InvalidUnlockTime),
        ("有效", 1, 999, ErrorCode::InvalidUnlockTime),
        ("有效", 1, 1_000, ErrorCode::InvalidUnlockTime),
    ] {
        assert_error(
            f.initialize_goal(false, 0, name, target, unlock)
                .map(|_| ()),
            error,
        );
        assert!(f.svm.get_account(&vault_pda(alice, 0)).is_none());
        assert_eq!(f.balance(alice), before);
    }
    let max_name = "储".repeat(21) + "a"; // exactly 64 bytes
    let vault = f
        .initialize_goal(false, 0, &max_name, u64::MAX, 1_001)
        .unwrap();
    assert_eq!(read_vault(&f, vault).name, max_name);
}

#[test]
fn locked_vault_rejects_withdrawal_and_close_until_exact_unlock_time() {
    use savings_vault::error::ErrorCode;
    let mut f = Fixture::new();
    f.set_time(1_000);
    let alice = f.alice.pubkey();
    let vault = f
        .initialize_goal(false, 42, "定期储蓄", 100, 2_000)
        .unwrap();
    let created: savings_vault::VaultCreated = event(&f);
    assert_eq!(created.unlock_at, 2_000);
    let reserve = f.balance(vault);
    // A locked vault cannot be closed early, even when it holds only rent.
    assert_error(f.send(false, close(alice, vault)), ErrorCode::VaultLocked);
    f.send(false, deposit(alice, vault, 100)).unwrap();
    let deposited: savings_vault::VaultDeposited = event(&f);
    assert_eq!(deposited.vault, vault);
    assert_eq!(deposited.authority, alice);
    assert_eq!(deposited.amount, 100);
    assert_eq!(deposited.available_lamports, 100);
    assert_eq!(deposited.timestamp, 1_000);
    let wallet_before = f.balance(alice);
    for timestamp in [1_000, 1_999] {
        f.set_time(timestamp);
        // Reaching the target does not unlock the vault.
        assert_error(
            f.send(false, withdraw(alice, vault, 100)),
            ErrorCode::VaultLocked,
        );
        assert_error(f.send(false, close(alice, vault)), ErrorCode::VaultLocked);
        assert_eq!(f.balance(vault), reserve + 100);
        assert_eq!(f.balance(alice), wallet_before);
        assert_eq!(read_vault(&f, vault).unlock_at, 2_000);
    }
    f.set_time(2_000);
    assert_error(f.send(false, close(alice, vault)), ErrorCode::VaultNotEmpty);
    f.send(false, withdraw(alice, vault, 40)).unwrap();
    let withdrawn: savings_vault::VaultWithdrawn = event(&f);
    assert_eq!(withdrawn.vault, vault);
    assert_eq!(withdrawn.authority, alice);
    assert_eq!(withdrawn.amount, 40);
    assert_eq!(withdrawn.available_lamports, 60);
    assert_eq!(withdrawn.timestamp, 2_000);
    f.set_time(2_001);
    f.send(false, withdraw(alice, vault, 60)).unwrap();
    let before_close = f.balance(alice);
    f.send(false, close(alice, vault)).unwrap();
    let closed: savings_vault::VaultClosed = event(&f);
    assert_eq!(closed.vault, vault);
    assert_eq!(closed.authority, alice);
    assert_eq!(closed.returned_lamports, reserve);
    assert_eq!(closed.timestamp, 2_001);
    assert!(f.svm.get_account(&vault).is_none());
    assert_eq!(f.balance(alice), before_close + reserve);
}

#[test]
fn empty_locked_vault_can_close_at_unlock_time() {
    let mut f = Fixture::new();
    f.set_time(1_000);
    let alice = f.alice.pubkey();
    let vault = f.initialize_goal(false, 0, "空储蓄罐", 100, 1_001).unwrap();
    f.set_time(1_001);
    f.send(false, close(alice, vault)).unwrap();
    assert!(f.svm.get_account(&vault).is_none());
}
