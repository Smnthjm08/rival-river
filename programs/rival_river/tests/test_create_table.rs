mod common;

use {
    anchor_lang::{
        prelude::Pubkey, solana_program::instruction::Instruction, AccountDeserialize,
        InstructionData, ToAccountMetas,
    },
    anchor_spl::{
        associated_token::{self, get_associated_token_address},
        token,
    },
    common::{balance, create_mint, create_mint_at, fund},
    litesvm::LiteSVM,
    rival_river::constants::TABLE_SEED,
    rival_river::state::{Table, TableStatus},
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
    Setup {
        svm,
        creator,
        opponent,
        mint,
    }
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
    create_table_with(s, table_id, opponent, stake, Pubkey::default())
}

fn create_table_with(s: &mut Setup, table_id: u64, opponent: Pubkey, stake: u64, session_key: Pubkey) -> bool {
    let creator = s.creator.pubkey();
    let table = table_pda(&creator, table_id);
    let ix = Instruction::new_with_bytes(
        rival_river::id(),
        &rival_river::instruction::CreateTable {
            table_id,
            opponent,
            stake,
            session_key,
        }
        .data(),
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
    join_table_with(s, signer, table, Pubkey::default())
}

fn join_table_with(s: &mut Setup, signer: &Keypair, table: Pubkey, session_key: Pubkey) -> bool {
    let ix = Instruction::new_with_bytes(
        rival_river::id(),
        &rival_river::instruction::JoinTable { session_key }.data(),
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
    assert_eq!(
        (t.table_id, t.creator, t.opponent),
        (7, s.creator.pubkey(), opponent)
    );
    assert_eq!((t.mint, t.stake), (s.mint, STAKE));
    assert_eq!(t.status, TableStatus::WaitingForOpponent);

    assert_eq!(
        balance(&s.svm, get_associated_token_address(&table, &s.mint)),
        STAKE
    );
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
    assert!(
        !create_table(&mut s, 1, opponent, 4 * STAKE),
        "more than the creator holds"
    );
}

#[test]
fn opponent_joins_and_locks_both_stakes() {
    let mut s = setup();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(create_table(&mut s, 1, opponent.pubkey(), STAKE));
    let table = table_pda(&creator.pubkey(), 1);

    assert!(
        !join_table(&mut s, &creator, table),
        "creator can't take the opponent's seat"
    );
    assert!(join_table(&mut s, &opponent, table));
    assert!(!join_table(&mut s, &opponent, table), "only once");

    assert_eq!(read_table(&s.svm, table).status, TableStatus::Locked);
    assert_eq!(
        balance(&s.svm, get_associated_token_address(&table, &s.mint)),
        2 * STAKE
    );
    assert_eq!(wallet(&s, &opponent), 2 * STAKE);
    assert!(
        !cancel_table(&mut s, &creator, table),
        "stakes are locked once both are in"
    );
}

#[test]
fn creator_can_cancel_before_anyone_joins() {
    let mut s = setup();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(create_table(&mut s, 1, opponent.pubkey(), STAKE));
    let table = table_pda(&creator.pubkey(), 1);

    assert!(!cancel_table(&mut s, &opponent, table));
    assert!(cancel_table(&mut s, &creator, table));
    assert!(s.svm.get_account(&table).map_or(true, |a| a.lamports == 0), "table closed");
    assert_eq!(wallet(&s, &creator), 3 * STAKE);
    assert!(
        s.svm
            .get_account(&get_associated_token_address(&table, &s.mint))
            .map_or(true, |a| a.lamports == 0),
        "vault closed"
    );
    assert!(!join_table(&mut s, &opponent, table), "too late to join");
}

// ---- Refund deadline ----------------------------------------------------------

fn refund(s: &mut Setup, table: Pubkey) -> bool {
    let (creator, opponent) = (s.creator.pubkey(), s.opponent.pubkey());
    let game = Pubkey::find_program_address(
        &[rival_river::constants::GAME_SEED, table.as_ref()],
        &rival_river::id(),
    )
    .0;
    let pda = |seeds: &[&[u8]]| Pubkey::find_program_address(seeds, &rival_river::id()).0;
    use rival_river::constants::{DECK_SEED, HAND_SEED};
    let ix = Instruction::new_with_bytes(
        rival_river::id(),
        &rival_river::instruction::Refund {}.data(),
        rival_river::accounts::Refund {
            table,
            game,
            deck: pda(&[DECK_SEED, game.as_ref()]),
            hand_creator: pda(&[HAND_SEED, game.as_ref(), creator.as_ref()]),
            hand_opponent: pda(&[HAND_SEED, game.as_ref(), opponent.as_ref()]),
            mint: s.mint,
            creator_token: get_associated_token_address(&creator, &s.mint),
            opponent_token: get_associated_token_address(&opponent, &s.mint),
            vault: get_associated_token_address(&table, &s.mint),
            creator,
            token_program: token::ID,
        }
        .to_account_metas(None),
    );
    let payer = s.opponent.insecure_clone();
    send(&mut s.svm, &payer, ix)
}

fn advance_clock(svm: &mut LiteSVM, seconds: i64) {
    let mut clock: anchor_lang::prelude::Clock = svm.get_sysvar();
    clock.unix_timestamp += seconds;
    svm.set_sysvar(&clock);
}

#[test]
fn stakes_come_back_if_the_game_never_starts() {
    let mut s = setup();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(create_table(&mut s, 1, opponent.pubkey(), STAKE));
    let table = table_pda(&creator.pubkey(), 1);
    assert!(join_table(&mut s, &opponent, table));
    let t = read_table(&s.svm, table);
    assert!(t.deadline > 0, "set when the opponent joins");

    // The creator never runs init_game.
    assert!(!refund(&mut s, table), "too early");
    advance_clock(&mut s.svm, rival_river::constants::MATCH_SECONDS + 1);
    assert!(refund(&mut s, table));
    assert!(s.svm.get_account(&table).map_or(true, |a| a.lamports == 0), "table closed");
    assert_eq!(
        (wallet(&s, &creator), wallet(&s, &opponent)),
        (3 * STAKE, 3 * STAKE)
    );
    assert!(!refund(&mut s, table), "only once");
}

#[test]
fn unjoined_table_is_cancelled_not_refunded() {
    let mut s = setup();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(create_table(&mut s, 1, opponent.pubkey(), STAKE));
    let table = table_pda(&creator.pubkey(), 1);
    advance_clock(&mut s.svm, rival_river::constants::MATCH_SECONDS + 1);
    assert!(!refund(&mut s, table));
    assert!(cancel_table(&mut s, &creator, table));
}

#[test]
fn only_usdc_can_be_staked() {
    let mut s = setup();
    let fake = create_mint_at(&mut s.svm, Pubkey::new_unique());
    fund(&mut s.svm, s.creator.pubkey(), fake, STAKE);
    s.mint = fake;
    let opponent = s.opponent.pubkey();
    assert!(!create_table(&mut s, 1, opponent, STAKE));
}

#[test]
fn table_opens_even_if_someone_created_its_vault_first() {
    let mut s = setup();
    let table = table_pda(&s.creator.pubkey(), 1);
    // Anyone can create the table PDA's token account before the creator does.
    let vault = fund(&mut s.svm, table, s.mint, 0);
    let opponent = s.opponent.pubkey();
    assert!(create_table(&mut s, 1, opponent, STAKE));
    assert_eq!(balance(&s.svm, vault), STAKE);
}

#[test]
fn session_keys_are_named_when_staking() {
    let mut s = setup();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    let (mine, theirs) = (Pubkey::new_unique(), Pubkey::new_unique());
    assert!(!create_table_with(&mut s, 1, opponent.pubkey(), STAKE, opponent.pubkey()), "the other seat's wallet");
    assert!(create_table_with(&mut s, 1, opponent.pubkey(), STAKE, mine));
    let table = table_pda(&creator.pubkey(), 1);

    // A key that already signs for the creator's seat is refused.
    assert!(!join_table_with(&mut s, &opponent, table, mine));
    assert!(!join_table_with(&mut s, &opponent, table, creator.pubkey()));
    assert!(join_table_with(&mut s, &opponent, table, theirs));
    assert_eq!(read_table(&s.svm, table).session_keys, [mine, theirs]);
}
