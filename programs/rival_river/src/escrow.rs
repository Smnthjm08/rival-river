//! Moving stakes in and out of a table's vault. The vault is the Table PDA's
//! associated token account for the table's mint. It stays on Solana for the
//! whole match: only Game, Deck and Hands are ever delegated.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    close_account, transfer_checked, CloseAccount, Mint, TokenAccount, TokenInterface,
    TransferChecked,
};

use crate::constants::TABLE_SEED;
use crate::state::Table;

/// A player moves `amount` from their own token account into the vault.
/// They sign the transaction, so the token program accepts them as authority.
pub fn deposit<'info>(
    player: &Signer<'info>,
    from: &InterfaceAccount<'info, TokenAccount>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    token_program: &Interface<'info, TokenInterface>,
    amount: u64,
) -> Result<()> {
    let accounts = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: vault.to_account_info(),
        authority: player.to_account_info(),
    };
    transfer_checked(
        CpiContext::new(token_program.key(), accounts),
        amount,
        mint.decimals,
    )
}

/// Pays the whole vault to `to`, then closes it (rent to `rent_to`).
pub fn release<'info>(
    table: &Account<'info, Table>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    rent_to: AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<()> {
    pay(table, vault, mint, to, vault.amount, token_program)?;
    close_vault(table, vault, rent_to, token_program)
}

/// Moves `amount` out of the vault, signing as the Table PDA.
pub fn pay<'info>(
    table: &Account<'info, Table>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    amount: u64,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<()> {
    let id = table.table_id.to_le_bytes();
    let seeds: &[&[u8]] = &[TABLE_SEED, table.creator.as_ref(), &id, &[table.bump]];
    let accounts = TransferChecked {
        from: vault.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: table.to_account_info(),
    };
    transfer_checked(
        CpiContext::new_with_signer(token_program.key(), accounts, &[seeds]),
        amount,
        mint.decimals,
    )
}

/// Closes the empty vault, rent to `rent_to`.
pub fn close_vault<'info>(
    table: &Account<'info, Table>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    rent_to: AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<()> {
    let id = table.table_id.to_le_bytes();
    let seeds: &[&[u8]] = &[TABLE_SEED, table.creator.as_ref(), &id, &[table.bump]];
    let accounts = CloseAccount {
        account: vault.to_account_info(),
        destination: rent_to,
        authority: table.to_account_info(),
    };
    close_account(CpiContext::new_with_signer(
        token_program.key(),
        accounts,
        &[seeds],
    ))
}
