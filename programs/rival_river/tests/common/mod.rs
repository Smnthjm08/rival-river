//! Token setup for LiteSVM tests. Writes SPL Token accounts' bytes directly
//! (82-byte Mint, 165-byte token account) instead of sending setup
//! transactions: tests only need the accounts to exist.
#![allow(dead_code)]
use {
    anchor_lang::prelude::Pubkey,
    anchor_spl::{associated_token::get_associated_token_address, token},
    litesvm::LiteSVM,
    solana_account::Account,
};

pub const DECIMALS: u8 = 6;

/// A fresh mint, like devnet USDC (6 decimals).
pub fn create_mint(svm: &mut LiteSVM) -> Pubkey {
    let mint = Pubkey::new_unique();
    let mut data = vec![0u8; 82];
    // mint_authority: None, supply: 0
    data[44] = DECIMALS;
    data[45] = 1; // is_initialized
    write(svm, mint, data);
    mint
}

/// `owner`'s associated token account for `mint`, holding `amount`.
pub fn fund(svm: &mut LiteSVM, owner: Pubkey, mint: Pubkey, amount: u64) -> Pubkey {
    let ata = get_associated_token_address(&owner, &mint);
    let mut data = vec![0u8; 165];
    data[0..32].copy_from_slice(mint.as_ref());
    data[32..64].copy_from_slice(owner.as_ref());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1; // state: Initialized
    write(svm, ata, data);
    ata
}

pub fn balance(svm: &LiteSVM, account: Pubkey) -> u64 {
    let data = svm.get_account(&account).unwrap().data;
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

fn write(svm: &mut LiteSVM, address: Pubkey, data: Vec<u8>) {
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(
        address,
        Account {
            lamports,
            data,
            owner: token::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}
