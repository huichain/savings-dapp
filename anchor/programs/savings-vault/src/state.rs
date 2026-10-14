use anchor_lang::prelude::*;

/// SOL is held directly in this program-owned account.
#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub authority: Pubkey,
    pub vault_id: u64,
    /// At most 64 UTF-8 bytes, not 64 characters.
    #[max_len(64)]
    pub name: String,
    /// Display-only progress target. It does not cap deposits or control unlocking.
    pub target_lamports: u64,
    pub created_at: i64,
    /// Zero means flexible savings. Any other value is a lock that cannot be removed early.
    pub unlock_at: i64,
}

/// Account data length, including the 8-byte discriminator. Used when creating and querying vaults.
#[constant]
pub const VAULT_SPACE: u64 = (8 + Vault::INIT_SPACE) as u64;
