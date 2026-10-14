pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("HDrUXhCBtQZVWFsz7v6qqo1wncJppuMsnSA5rtwfnRp1");

#[program]
pub mod savings_vault {
    use super::*;

    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        vault_id: u64,
        name: String,
        target_lamports: u64,
        unlock_at: i64,
    ) -> Result<()> {
        handle_initialize_vault(ctx, vault_id, name, target_lamports, unlock_at)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        handle_deposit(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        handle_withdraw(ctx, amount)
    }

    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        handle_close_vault(ctx)
    }
}
