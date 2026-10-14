use anchor_lang::prelude::*;

// Preserve vault error codes after removing the counter example.
#[error_code(offset = 6002)]
pub enum ErrorCode {
    #[msg("Only the vault authority can operate this vault")]
    VaultUnauthorized,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Withdrawal exceeds the balance available above the rent reserve")]
    InsufficientVaultFunds,
    #[msg("Withdraw all available SOL before closing the vault")]
    VaultNotEmpty,
    #[msg("Vault name must contain non-whitespace text and be at most 64 UTF-8 bytes")]
    InvalidVaultName,
    #[msg("Target amount must be greater than zero")]
    InvalidTargetAmount,
    #[msg("Unlock time must be zero or a future Unix timestamp")]
    InvalidUnlockTime,
    #[msg("Vault is locked until its unlock time")]
    VaultLocked,
}
