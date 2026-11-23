//! Rollup tests. MagicSVM runs Solana ("Base") and the ephemeral rollup
//! ("Ephemeral") in one process, so delegation can be tested without validators.
//! Run with `cargo +stable test` from this folder, after `anchor build`.
use {
    anchor_lang::{prelude::Pubkey, system_program, AccountDeserialize, Id, InstructionData, ToAccountMetas},
    ephemeral_rollups_sdk::{
        anchor::{DelegationProgram, MagicProgram},
        consts::{DELEGATION_PROGRAM_ID, MAGIC_CONTEXT_ID},
        pda::{
            delegate_buffer_pda_from_delegated_account_and_owner_program,
            delegation_metadata_pda_from_delegated_account,
            delegation_record_pda_from_delegated_account,
        },
    },
    magicsvm::{MagicSVM, TransactionTarget::{self, Base, Ephemeral}},
    rival_river::{accounts, instruction, state::Game},
    solana_address::Address,
    solana_instruction::{AccountMeta, Instruction},
    solana_keypair::Keypair,
    solana_message::Message,
    solana_signer::Signer,
    solana_transaction::Transaction,
};

const SO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../target/deploy/rival_river.so");

/// Anchor uses its own Pubkey type; MagicSVM uses Address. Same 32 bytes.
fn addr(p: Pubkey) -> Address {
    Address::new_from_array(p.to_bytes())
}

fn key(k: &Keypair) -> Pubkey {
    Pubkey::new_from_array(k.pubkey().to_bytes())
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &rival_river::id()).0
}

fn ix(data: impl InstructionData, accounts: impl ToAccountMetas) -> Instruction {
    Instruction {
        program_id: addr(rival_river::id()),
        accounts: accounts
            .to_account_metas(None)
            .into_iter()
            .map(|m| AccountMeta { pubkey: addr(m.pubkey), is_signer: m.is_signer, is_writable: m.is_writable })
            .collect(),
        data: data.data(),
    }
}

fn send(svm: &mut MagicSVM, target: TransactionTarget, signer: &Keypair, ix: Instruction) -> bool {
    let msg = Message::new(&[ix], Some(&signer.pubkey()));
    let tx = Transaction::new(&[signer], msg, svm.latest_blockhash_for(target));
    let ok = svm.send_transaction_to(target, tx).is_ok();
    svm.expire_blockhash_for(target);
    ok
}

fn owner(svm: &MagicSVM, target: TransactionTarget, account: Pubkey) -> Pubkey {
    Pubkey::new_from_array(svm.get_account_for(target, &addr(account)).unwrap().owner.to_bytes())
}

struct Setup {
    svm: MagicSVM,
    creator: Keypair,
    opponent: Keypair,
    table: Pubkey,
    game: Pubkey,
}

/// Creates a table between two funded players. Does NOT run init_game.
fn setup() -> Setup {
    let mut svm = MagicSVM::new();
    svm.add_program_from_file(addr(rival_river::id()), SO).unwrap();
    let creator = Keypair::new();
    let opponent = Keypair::new();
    for k in [&creator, &opponent] {
        svm.airdrop(&k.pubkey(), 2_000_000_000).unwrap();
    }
    let table = pda(&[b"table", key(&creator).as_ref(), &1u64.to_le_bytes()]);
    let game = pda(&[b"game", table.as_ref()]);
    assert!(send(&mut svm, Base, &creator, ix(
        instruction::CreateTable { table_id: 1, opponent: key(&opponent), creator_nft: Pubkey::new_unique() },
        accounts::CreateTable { creator: key(&creator), table, system_program: system_program::ID },
    )));
    Setup { svm, creator, opponent, table, game }
}

fn init_game(s: &mut Setup) {
    let creator = key(&s.creator);
    assert!(send(&mut s.svm, Base, &s.creator, ix(
        instruction::InitGame {},
        accounts::InitGame { creator, table: s.table, game: s.game, system_program: system_program::ID },
    )));
}

fn delegate_game(s: &mut Setup, signer: &Keypair) -> bool {
    let (table, game) = (s.table, s.game);
    let mut ix = ix(
        instruction::DelegateGame {},
        accounts::DelegateGame {
            payer: key(signer),
            table,
            buffer_game: delegate_buffer_pda_from_delegated_account_and_owner_program(&game, &rival_river::id()),
            delegation_record_game: delegation_record_pda_from_delegated_account(&game),
            delegation_metadata_game: delegation_metadata_pda_from_delegated_account(&game),
            game,
            owner_program: rival_river::id(),
            delegation_program: DelegationProgram::id(),
            system_program: system_program::ID,
        },
    );
    // Pin MagicSVM's in-process rollup validator (the optional remaining account).
    ix.accounts.push(AccountMeta::new_readonly(s.svm.validator_identity(), false));
    send(&mut s.svm, Base, signer, ix)
}

#[test]
fn player_delegates_game_to_rollup() {
    let mut s = setup();
    init_game(&mut s);
    assert_eq!(owner(&s.svm, Base, s.game), rival_river::id());

    let creator = s.creator.insecure_clone();
    assert!(delegate_game(&mut s, &creator));

    // On Solana the delegation program now owns Game; its data is unchanged.
    assert_eq!(owner(&s.svm, Base, s.game), Pubkey::new_from_array(DELEGATION_PROGRAM_ID.to_bytes()));
    let data = s.svm.get_account_for(Base, &addr(s.game)).unwrap().data;
    let game = Game::try_deserialize(&mut data.as_slice()).unwrap();
    assert_eq!(game.table, s.table);
    assert_eq!(game.hand_number, 0);
}

#[test]
fn opponent_can_delegate_too() {
    let mut s = setup();
    init_game(&mut s);
    let opponent = s.opponent.insecure_clone();
    assert!(delegate_game(&mut s, &opponent));
}

#[test]
fn stranger_cannot_delegate() {
    let mut s = setup();
    init_game(&mut s);
    let stranger = Keypair::new();
    s.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    assert!(!delegate_game(&mut s, &stranger));
    assert_eq!(owner(&s.svm, Base, s.game), rival_river::id());
}

#[test]
fn cannot_delegate_before_init_game() {
    let mut s = setup();
    let creator = s.creator.insecure_clone();
    assert!(!delegate_game(&mut s, &creator));
}

// ---- Rollup play + undelegate ----------------------------------------------

fn read_game(svm: &MagicSVM, target: TransactionTarget, game: Pubkey) -> Game {
    let data = svm.get_account_for(target, &addr(game)).unwrap().data;
    Game::try_deserialize(&mut data.as_slice()).unwrap()
}

fn next_hand(s: &mut Setup, signer: &Keypair) -> bool {
    let game = s.game;
    send(&mut s.svm, Ephemeral, signer, ix(
        instruction::NextHand {},
        accounts::NextHand { player: key(signer), game },
    ))
}

fn undelegate_game(s: &mut Setup, signer: &Keypair) -> bool {
    let game = s.game;
    send(&mut s.svm, Ephemeral, signer, ix(
        instruction::UndelegateGame {},
        accounts::UndelegateGame {
            payer: key(signer),
            game,
            magic_program: MagicProgram::id(),
            magic_context: MAGIC_CONTEXT_ID,
        },
    ))
}

/// init_game + delegate_game, ready for play on the rollup.
fn delegated() -> Setup {
    let mut s = setup();
    init_game(&mut s);
    let creator = s.creator.insecure_clone();
    assert!(delegate_game(&mut s, &creator));
    s
}

#[test]
fn rollup_changes_land_back_on_solana() {
    let mut s = delegated();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());

    // Both players play on the rollup. Solana's copy doesn't change yet.
    assert!(next_hand(&mut s, &creator));
    assert!(next_hand(&mut s, &opponent));
    assert_eq!(read_game(&s.svm, Ephemeral, s.game).hand_number, 2);
    assert_eq!(read_game(&s.svm, Base, s.game).hand_number, 0);

    // Undelegate: data is written back and ownership returns to our program.
    assert!(undelegate_game(&mut s, &creator));
    assert_eq!(owner(&s.svm, Base, s.game), rival_river::id());
    let game = read_game(&s.svm, Base, s.game);
    assert_eq!(game.hand_number, 2);
    assert_eq!(game.players, [key(&s.creator), key(&s.opponent)]);
}

#[test]
fn stranger_cannot_play_or_undelegate() {
    let mut s = delegated();
    let stranger = Keypair::new();
    s.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();

    assert!(!next_hand(&mut s, &stranger));
    assert!(!undelegate_game(&mut s, &stranger));
    assert_eq!(owner(&s.svm, Base, s.game), Pubkey::new_from_array(DELEGATION_PROGRAM_ID.to_bytes()));
}

#[test]
fn game_is_locked_on_solana_while_delegated() {
    let mut s = delegated();
    let creator = s.creator.insecure_clone();
    // Sending next_hand to Solana instead of the rollup fails: Solana's copy is
    // owned by the delegation program, so our program can't write to it there.
    let game = s.game;
    assert!(!send(&mut s.svm, Base, &creator, ix(
        instruction::NextHand {},
        accounts::NextHand { player: key(&creator), game },
    )));
}
