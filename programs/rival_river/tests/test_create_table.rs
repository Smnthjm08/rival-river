mod common;

use {
    anchor_lang::{
        prelude::Pubkey, solana_program::instruction::Instruction, AccountDeserialize,
        InstructionData, ToAccountMetas,
    },
    anchor_spl::{associated_token::{self, get_associated_token_address}, token},
    common::{balance, create_mint, fund},
    litesvm::LiteSVM,
    rival_river::state::{Table, TableStatus},
    rival_river::constants::TABLE_SEED,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

/// 10 USDC (6 decimals).
const STAKE: u64 = 10_000_000;

struct Setup {
    svm: LiteSVM,
    creator: Keypair,
    opponent: Keypair,
    mint: Pubkey,
}

/// Two funded players, each holding 3 stakes' worth of a fresh mint.
fn setup() -> Setup {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/rival_river.so");
    svm.add_program(rival_river::id(), bytes).unwrap();
    let (creator, opponent) = (Keypair::new(), Keypair::new());
    let mint = create_mint(&mut svm);
    for k in [&creator, &opponent] {
        svm.airdrop(&k.pubkey(), 1_000_000_000).unwrap();
        fund(&mut svm, k.pubkey(), mint, 3 * STAKE);
    }
    Setup { svm, creator, opponent, mint }
}

fn table_pda(creator: &Pubkey, table_id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[TABLE_SEED, creator.as_ref(), &table_id.to_le_bytes()],
        &rival_river::id(),
    )
    .0
}

fn send(svm: &mut LiteSVM, signer: &Keypair, ix: Instruction) -> bool {
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    let ok = svm.send_transaction(tx).is_ok();
    svm.expire_blockhash(); // so an identical retry isn't rejected as a duplicate tx
    ok
}

fn create_table(s: &mut Setup, table_id: u64, opponent: Pubkey, stake: u64) -> bool {
    let creator = s.creator.pubkey();
    let table = table_pda(&creator, table_id);
    let ix = Instruction::new_with_bytes(
        rival_river::id(),
        &rival_river::instruction::CreateTable { table_id, opponent, stake }.data(),
        rival_river::accounts::CreateTable {
            creator,
            table,
            mint: s.mint,
            creator_token: get_associated_token_address(&creator, &s.mint),
            vault: get_associated_token_address(&table, &s.mint),
            token_program: token::ID,
            associated_token_program: associated_token::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    );
    let creator = s.creator.insecure_clone();
    send(&mut s.svm, &creator, ix)
}

fn join_table(s: &mut Setup, signer: &Keypair, table: Pubkey) -> bool {
    let ix = Instruction::new_with_bytes(
        rival_river::id(),
        &rival_river::instruction::JoinTable {}.data(),
        rival_river::accounts::JoinTable {
            opponent: signer.pubkey(),
            table,
            mint: s.mint,
            opponent_token: get_associated_token_address(&signer.pubkey(), &s.mint),
            vault: get_associated_token_address(&table, &s.mint),
            token_program: token::ID,
        }
        .to_account_metas(None),
    );
    send(&mut s.svm, signer, ix)
}

fn cancel_table(s: &mut Setup, signer: &Keypair, table: Pubkey) -> bool {
    let ix = Instruction::new_with_bytes(
        rival_river::id(),
        &rival_river::instruction::CancelTable {}.data(),
        rival_river::accounts::CancelTable {
            creator: signer.pubkey(),
            table,
            mint: s.mint,
            creator_token: get_associated_token_address(&signer.pubkey(), &s.mint),
            vault: get_associated_token_address(&table, &s.mint),
            token_program: token::ID,
        }
        .to_account_metas(None),
    );
    send(&mut s.svm, signer, ix)
}

fn read_table(svm: &LiteSVM, table: Pubkey) -> Table {
    Table::try_deserialize(&mut svm.get_account(&table).unwrap().data.as_slice()).unwrap()
}

fn wallet(s: &Setup, k: &Keypair) -> u64 {
    balance(&s.svm, get_associated_token_address(&k.pubkey(), &s.mint))
}

#[test]
fn create_table_escrows_the_creators_stake() {
    let mut s = setup();
    let opponent = s.opponent.pubkey();
    assert!(create_table(&mut s, 7, opponent, STAKE));

    let table = table_pda(&s.creator.pubkey(), 7);
    assert_eq!(s.svm.get_account(&table).unwrap().owner, rival_river::id());
    let t = read_table(&s.svm, table);
    assert_eq!((t.table_id, t.creator, t.opponent), (7, s.creator.pubkey(), opponent));
    assert_eq!((t.mint, t.stake), (s.mint, STAKE));
    assert_eq!(t.status, TableStatus::WaitingForOpponent);

    assert_eq!(balance(&s.svm, get_associated_token_address(&table, &s.mint)), STAKE);
    let creator = s.creator.insecure_clone();
    assert_eq!(wallet(&s, &creator), 2 * STAKE);
}

#[test]
fn same_table_id_twice_fails() {
    let mut s = setup();
    let opponent = s.opponent.pubkey();
    assert!(create_table(&mut s, 1, opponent, STAKE));
    assert!(!create_table(&mut s, 1, opponent, STAKE));
    // A different id is a different table.
    assert!(create_table(&mut s, 2, opponent, STAKE));
}

#[test]
fn cannot_invite_yourself_or_stake_nothing() {
    let mut s = setup();
    let me = s.creator.pubkey();
    let opponent = s.opponent.pubkey();
    assert!(!create_table(&mut s, 1, me, STAKE));
    assert!(!create_table(&mut s, 1, opponent, 0));
    assert!(!create_table(&mut s, 1, opponent, 4 * STAKE), "more than the creator holds");
}

#[test]
fn opponent_joins_and_locks_both_stakes() {
    let mut s = setup();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(create_table(&mut s, 1, opponent.pubkey(), STAKE));
    let table = table_pda(&creator.pubkey(), 1);

    assert!(!join_table(&mut s, &creator, table), "creator can't take the opponent's seat");
    assert!(join_table(&mut s, &opponent, table));
    assert!(!join_table(&mut s, &opponent, table), "only once");

    assert_eq!(read_table(&s.svm, table).status, TableStatus::Locked);
    assert_eq!(balance(&s.svm, get_associated_token_address(&table, &s.mint)), 2 * STAKE);
    assert_eq!(wallet(&s, &opponent), 2 * STAKE);
    assert!(!cancel_table(&mut s, &creator, table), "stakes are locked once both are in");
}

#[test]
fn creator_can_cancel_before_anyone_joins() {
    let mut s = setup();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(create_table(&mut s, 1, opponent.pubkey(), STAKE));
    let table = table_pda(&creator.pubkey(), 1);

    assert!(!cancel_table(&mut s, &opponent, table));
    assert!(cancel_table(&mut s, &creator, table));
    assert_eq!(read_table(&s.svm, table).status, TableStatus::Refunded);
    assert_eq!(wallet(&s, &creator), 3 * STAKE);
    assert!(s.svm.get_account(&get_associated_token_address(&table, &s.mint)).map_or(true, |a| a.lamports == 0),
        "vault closed");
    assert!(!join_table(&mut s, &opponent, table), "too late to join");
}
