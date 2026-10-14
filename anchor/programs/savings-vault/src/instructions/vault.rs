use anchor_lang::prelude::*;

use crate::{
    constants::VAULT_SEED,
    error::ErrorCode,
    state::{Vault, VAULT_SPACE},
};

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = VAULT_SPACE as usize,
        seeds = [VAULT_SEED, authority.key().as_ref(), &vault_id.to_le_bytes()],
        bump,
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_vault(
    ctx: Context<InitializeVault>,
    vault_id: u64,
    name: String,
    target_lamports: u64,
    unlock_at: i64,
) -> Result<()> {
    require!(
        !name.trim().is_empty() && name.len() <= 64,
        ErrorCode::InvalidVaultName,
    );
    require!(target_lamports > 0, ErrorCode::InvalidTargetAmount);
    let now = Clock::get()?.unix_timestamp;
    require!(
        unlock_at == 0 || (unlock_at > 0 && unlock_at > now),
        ErrorCode::InvalidUnlockTime
    );

    let vault = &mut ctx.accounts.vault;
    vault.authority = ctx.accounts.authority.key();
    vault.vault_id = vault_id;
    vault.name = name;
    vault.target_lamports = target_lamports;
    vault.created_at = now;
    vault.unlock_at = unlock_at;
    emit!(VaultCreated {
        vault: vault.key(),
        authority: vault.authority,
        vault_id,
        name: vault.name.clone(),
        target_lamports,
        created_at: now,
        unlock_at,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.authority.as_ref(), &vault.vault_id.to_le_bytes()],
        bump,
        has_one = authority @ ErrorCode::VaultUnauthorized,
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

pub fn handle_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    // The wallet is system-owned, so SOL is transferred with a system CPI. `amount` is lamports.
    let accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.authority.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
    };
    anchor_lang::system_program::transfer(
        CpiContext::new(ctx.accounts.system_program.key(), accounts),
        amount,
    )?;
    emit!(VaultDeposited {
        vault: ctx.accounts.vault.key(),
        authority: ctx.accounts.authority.key(),
        amount,
        available_lamports: available_lamports(&ctx.accounts.vault.to_account_info())?,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.authority.as_ref(), &vault.vault_id.to_le_bytes()],
        bump,
        has_one = authority @ ErrorCode::VaultUnauthorized,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn handle_withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);
    require_unlocked(&ctx.accounts.vault)?;
    require!(
        amount <= available_lamports(&ctx.accounts.vault.to_account_info())?,
        ErrorCode::InsufficientVaultFunds,
    );

    // This program owns the vault, so it debits lamports directly. A system transfer cannot debit it.
    // Anchor's helpers use checked arithmetic. Any failure rolls the transaction back.
    ctx.accounts.vault.sub_lamports(amount)?;
    ctx.accounts.authority.add_lamports(amount)?;
    emit!(VaultWithdrawn {
        vault: ctx.accounts.vault.key(),
        authority: ctx.accounts.authority.key(),
        amount,
        available_lamports: available_lamports(&ctx.accounts.vault.to_account_info())?,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.authority.as_ref(), &vault.vault_id.to_le_bytes()],
        bump,
        has_one = authority @ ErrorCode::VaultUnauthorized,
        close = authority,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn handle_close_vault(ctx: Context<CloseVault>) -> Result<()> {
    // An empty vault stays locked. Closing it must not return the rent early.
    require_unlocked(&ctx.accounts.vault)?;
    require!(
        available_lamports(&ctx.accounts.vault.to_account_info())? == 0,
        ErrorCode::VaultNotEmpty,
    );
    emit!(VaultClosed {
        vault: ctx.accounts.vault.key(),
        authority: ctx.accounts.authority.key(),
        returned_lamports: ctx.accounts.vault.to_account_info().lamports(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    // After this returns, Anchor closes the account and sends the remaining lamports to `authority`.
    Ok(())
}

fn available_lamports(vault: &AccountInfo<'_>) -> Result<u64> {
    let reserve = Rent::get()?.minimum_balance(vault.data_len());
    // Never treat the rent reserve as withdrawable, even if the rent-exempt minimum later exceeds the balance.
    Ok(vault.lamports().saturating_sub(reserve))
}

fn require_unlocked(vault: &Vault) -> Result<()> {
    require!(
        vault.unlock_at == 0 || Clock::get()?.unix_timestamp >= vault.unlock_at,
        ErrorCode::VaultLocked,
    );
    Ok(())
}

#[event]
pub struct VaultCreated {
    pub vault: Pubkey,
    pub authority: Pubkey,
    pub vault_id: u64,
    pub name: String,
    pub target_lamports: u64,
    pub created_at: i64,
    pub unlock_at: i64,
}

#[event]
pub struct VaultDeposited {
    pub vault: Pubkey,
    pub authority: Pubkey,
    pub amount: u64,
    pub available_lamports: u64,
    pub timestamp: i64,
}

#[event]
pub struct VaultWithdrawn {
    pub vault: Pubkey,
    pub authority: Pubkey,
    pub amount: u64,
    pub available_lamports: u64,
    pub timestamp: i64,
}

#[event]
pub struct VaultClosed {
    pub vault: Pubkey,
    pub authority: Pubkey,
    pub returned_lamports: u64,
    pub timestamp: i64,
}
