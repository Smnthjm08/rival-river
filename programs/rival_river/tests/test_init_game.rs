mod common;

use {
    anchor_spl::{associated_token::{self, get_associated_token_address}, token},
    common::{create_mint, fund},
    anchor_lang::{
        prelude::Pubkey, solana_program::instruction::Instruction, AccountDeserialize,
        InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    rival_river::state::{Deck, Game, Hand, Phase, Table, TableStatus},
    rival_river::constants::{DECK_SEED, GAME_SEED, HAND_SEED, TABLE_SEED},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

/// 10 USDC (6 decimals).
const STAKE: u64 = 10_000_000;

fn setup() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/rival_river.so");
    svm.add_program(rival_river::id(), bytes).unwrap();
    let creator = Keypair::new();
    svm.airdrop(&creator.pubkey(), 1_000_000_000).unwrap();
    (svm, creator)
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &rival_river::id()).0
}

fn send(svm: &mut LiteSVM, signer: &Keypair, ix: Instruction) -> bool {
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    let ok = svm.send_transaction(tx).is_ok();
    svm.expire_blockhash();
    ok
}

/// Creates table #1 for `creator`. With `join`, an opponent also stakes, so
/// the table is Locked and ready for init_game.
fn create_table(svm: &mut LiteSVM, creator: &Keypair, join: bool) -> Pubkey {
    let mint = create_mint(svm);
    let opponent = Keypair::new();
    svm.airdrop(&opponent.pubkey(), 1_000_000_000).unwrap();
    let creator_token = fund(svm, creator.pubkey(), mint, STAKE);
    let opponent_token = fund(svm, opponent.pubkey(), mint, STAKE);
    let table = pda(&[TABLE_SEED, creator.pubkey().as_ref(), &1u64.to_le_bytes()]);
    let vault = get_associated_token_address(&table, &mint);

    let ix = Instruction::new_with_bytes(
        rival_river::id(),
        &rival_river::instruction::CreateTable { table_id: 1, opponent: opponent.pubkey(), stake: STAKE }
            .data(),
        rival_river::accounts::CreateTable {
            creator: creator.pubkey(),
            table,
            mint,
            creator_token,
            vault,
            token_program: token::ID,
            associated_token_program: associated_token::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    );
    assert!(send(svm, creator, ix));
    if join {
        let ix = Instruction::new_with_bytes(
            rival_river::id(),
            &rival_river::instruction::JoinTable {}.data(),
            rival_river::accounts::JoinTable {
                opponent: opponent.pubkey(),
                table,
                mint,
                opponent_token,
                vault,
                token_program: token::ID,
            }
            .to_account_metas(None),
        );
        assert!(send(svm, &opponent, ix));
    }
    table
}

fn read_table(svm: &LiteSVM, table: Pubkey) -> Table {
    Table::try_deserialize(&mut svm.get_account(&table).unwrap().data.as_slice()).unwrap()
}

fn init_game(svm: &mut LiteSVM, signer: &Keypair, table: Pubkey) -> bool {
    let t = read_table(svm, table);
    let game = pda(&[GAME_SEED, table.as_ref()]);
    let ix = Instruction::new_with_bytes(
        rival_river::id(),
        &rival_river::instruction::InitGame {}.data(),
        rival_river::accounts::InitGame {
            creator: signer.pubkey(),
            table,
            game,
            deck: pda(&[DECK_SEED, game.as_ref()]),
            hand_creator: pda(&[HAND_SEED, game.as_ref(), t.creator.as_ref()]),
            hand_opponent: pda(&[HAND_SEED, game.as_ref(), t.opponent.as_ref()]),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    );
    send(svm, signer, ix)
}

#[test]
fn creator_opens_game_for_their_table() {
    let (mut svm, creator) = setup();
    let table = create_table(&mut svm, &creator, true);

    assert!(init_game(&mut svm, &creator, table));
    assert_eq!(read_table(&svm, table).status, TableStatus::InPlay);

    let game_key = pda(&[GAME_SEED, table.as_ref()]);
    let account = svm.get_account(&game_key).unwrap();
    assert_eq!(account.owner, rival_river::id());
    let game = Game::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(game.table, table);
    assert_eq!(game.hand_number, 0);
    assert_eq!(game.stacks, [100, 100]);
    assert_eq!((game.bets, game.pot), ([0, 0], 0));
    assert_eq!(game.phase, Phase::Waiting);
    assert_eq!(game.winner, None);

    let account = svm.get_account(&pda(&[DECK_SEED, game_key.as_ref()])).unwrap();
    let deck = Deck::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(deck.game, game_key);
    assert!(!deck.shuffled);

    // One empty Hand per player.
    let t = read_table(&svm, table);
    for player in [t.creator, t.opponent] {
        let account = svm.get_account(&pda(&[HAND_SEED, game_key.as_ref(), player.as_ref()])).unwrap();
        let hand = Hand::try_deserialize(&mut account.data.as_slice()).unwrap();
        assert_eq!((hand.game, hand.player), (game_key, player));
        assert!(!hand.dealt && !hand.has_secret);
    }
}

#[test]
fn only_one_game_per_table() {
    let (mut svm, creator) = setup();
    let table = create_table(&mut svm, &creator, true);

    assert!(init_game(&mut svm, &creator, table));
    assert!(!init_game(&mut svm, &creator, table));
}

#[test]
fn stranger_cannot_open_game() {
    let (mut svm, creator) = setup();
    let table = create_table(&mut svm, &creator, true);
    let stranger = Keypair::new();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();

    assert!(!init_game(&mut svm, &stranger, table));
}

#[test]
fn game_needs_both_stakes() {
    let (mut svm, creator) = setup();
    let table = create_table(&mut svm, &creator, false);
    assert!(!init_game(&mut svm, &creator, table), "opponent hasn't joined");
}
