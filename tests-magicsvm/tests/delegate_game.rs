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
    rival_river::{accounts, constants::{DECK_SEED, GAME_SEED, HAND_SEED, TABLE_SEED}, instruction, state::{Game, Phase}},
    solana_address::Address,
    solana_compute_budget_interface::ComputeBudgetInstruction,
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
    send_ixs(svm, target, signer, &[ix])
}

/// Sends one transaction. Run tests with `RR_LOGS=1` to print the logs of
/// any transaction that fails.
fn send_ixs(svm: &mut MagicSVM, target: TransactionTarget, signer: &Keypair, ixs: &[Instruction]) -> bool {
    let msg = Message::new(ixs, Some(&signer.pubkey()));
    let tx = Transaction::new(&[signer], msg, svm.latest_blockhash_for(target));
    let res = svm.send_transaction_to(target, tx);
    if let (Err(f), Ok(_)) = (&res, std::env::var("RR_LOGS")) {
        eprintln!("{:?}\n{:#?}", f.err, f.meta.logs);
    }
    svm.expire_blockhash_for(target);
    res.is_ok()
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
    deck: Pubkey,
    hand_creator: Pubkey,
    hand_opponent: Pubkey,
    mint: Pubkey,
}

/// Creates a table between two funded players, and both stake: the table is
/// Locked. Does NOT run init_game.
fn setup() -> Setup {
    let mut svm = MagicSVM::new();
    svm.add_program_from_file(addr(rival_river::id()), SO).unwrap();
    let creator = Keypair::new();
    let opponent = Keypair::new();
    for k in [&creator, &opponent] {
        svm.airdrop(&k.pubkey(), 2_000_000_000).unwrap();
    }
    let table = pda(&[TABLE_SEED, key(&creator).as_ref(), &1u64.to_le_bytes()]);
    let game = pda(&[GAME_SEED, table.as_ref()]);
    let deck = pda(&[DECK_SEED, game.as_ref()]);
    let hand_creator = pda(&[HAND_SEED, game.as_ref(), key(&creator).as_ref()]);
    let hand_opponent = pda(&[HAND_SEED, game.as_ref(), key(&opponent).as_ref()]);
    let mint = create_mint(&mut svm);
    for k in [&creator, &opponent] {
        fund(&mut svm, key(k), mint, STAKE);
    }
    let vault = ata(table, mint);
    assert!(send(&mut svm, Base, &creator, ix(
        instruction::CreateTable { table_id: 1, opponent: key(&opponent), stake: STAKE },
        accounts::CreateTable {
            creator: key(&creator),
            table,
            mint,
            creator_token: ata(key(&creator), mint),
            vault,
            token_program: token_program(),
            associated_token_program: Pubkey::new_from_array(ASSOCIATED_TOKEN_PROGRAM_ID.to_bytes()),
            system_program: system_program::ID,
        },
    )));
    assert!(send(&mut svm, Base, &opponent, ix(
        instruction::JoinTable {},
        accounts::JoinTable {
            opponent: key(&opponent),
            table,
            mint,
            opponent_token: ata(key(&opponent), mint),
            vault,
            token_program: token_program(),
        },
    )));
    Setup { svm, creator, opponent, table, game, deck, hand_creator, hand_opponent, mint }
}

// ---- Tokens: raw SPL accounts, as in MagicSVM's own tests ------------------

use ephemeral_rollups_sdk::consts::{ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID};

/// 10 USDC (6 decimals).
const STAKE: u64 = 10_000_000;

fn token_program() -> Pubkey {
    Pubkey::new_from_array(TOKEN_PROGRAM_ID.to_bytes())
}

/// `owner`'s associated token account for `mint`.
fn ata(owner: Pubkey, mint: Pubkey) -> Pubkey {
    let program = Pubkey::new_from_array(ASSOCIATED_TOKEN_PROGRAM_ID.to_bytes());
    Pubkey::find_program_address(&[owner.as_ref(), token_program().as_ref(), mint.as_ref()], &program).0
}

fn write_token_account(svm: &mut MagicSVM, address: Pubkey, data: Vec<u8>) {
    let account = solana_account::Account {
        lamports: 10_000_000,
        data,
        owner: addr(token_program()),
        executable: false,
        rent_epoch: 0,
    };
    svm.set_account(addr(address), account).unwrap();
}

/// A fresh 6-decimal mint (82-byte SPL Mint: no authority, initialized).
fn create_mint(svm: &mut MagicSVM) -> Pubkey {
    let mint = Pubkey::new_unique();
    let mut data = vec![0u8; 82];
    data[44] = 6; // decimals
    data[45] = 1; // is_initialized
    write_token_account(svm, mint, data);
    mint
}

/// Gives `owner` an associated token account holding `amount` (165 bytes:
/// mint, owner, amount, ..., state = Initialized).
fn fund(svm: &mut MagicSVM, owner: Pubkey, mint: Pubkey, amount: u64) {
    let mut data = vec![0u8; 165];
    data[0..32].copy_from_slice(mint.as_ref());
    data[32..64].copy_from_slice(owner.as_ref());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1;
    write_token_account(svm, ata(owner, mint), data);
}

/// Token balance on Solana, or None if the account doesn't exist.
fn balance(svm: &MagicSVM, account: Pubkey) -> Option<u64> {
    let acc = svm.get_account_for(Base, &addr(account)).filter(|a| a.lamports > 0)?;
    Some(u64::from_le_bytes(acc.data[64..72].try_into().unwrap()))
}

fn init_game(s: &mut Setup) {
    let creator = key(&s.creator);
    assert!(send(&mut s.svm, Base, &s.creator, ix(
        instruction::InitGame {},
        accounts::InitGame {
            creator,
            table: s.table,
            game: s.game,
            deck: s.deck,
            hand_creator: s.hand_creator,
            hand_opponent: s.hand_opponent,
            system_program: system_program::ID,
        },
    )));
}

fn delegate_game(s: &mut Setup, signer: &Keypair) -> bool {
    let (table, game, deck) = (s.table, s.game, s.deck);
    let (hand_creator, hand_opponent) = (s.hand_creator, s.hand_opponent);
    let ix = ix(
        instruction::DelegateGame {},
        accounts::DelegateGame {
            payer: key(signer),
            table,
            buffer_game: delegate_buffer_pda_from_delegated_account_and_owner_program(&game, &rival_river::id()),
            delegation_record_game: delegation_record_pda_from_delegated_account(&game),
            delegation_metadata_game: delegation_metadata_pda_from_delegated_account(&game),
            game,
            buffer_deck: delegate_buffer_pda_from_delegated_account_and_owner_program(&deck, &rival_river::id()),
            delegation_record_deck: delegation_record_pda_from_delegated_account(&deck),
            delegation_metadata_deck: delegation_metadata_pda_from_delegated_account(&deck),
            deck,
            buffer_hand_creator: delegate_buffer_pda_from_delegated_account_and_owner_program(&hand_creator, &rival_river::id()),
            delegation_record_hand_creator: delegation_record_pda_from_delegated_account(&hand_creator),
            delegation_metadata_hand_creator: delegation_metadata_pda_from_delegated_account(&hand_creator),
            hand_creator,
            buffer_hand_opponent: delegate_buffer_pda_from_delegated_account_and_owner_program(&hand_opponent, &rival_river::id()),
            delegation_record_hand_opponent: delegation_record_pda_from_delegated_account(&hand_opponent),
            delegation_metadata_hand_opponent: delegation_metadata_pda_from_delegated_account(&hand_opponent),
            hand_opponent,
            owner_program: rival_river::id(),
            delegation_program: DelegationProgram::id(),
            system_program: system_program::ID,
        },
    );
    // Delegating 4 accounts can exceed the default 200k compute units, so the
    // client raises the limit (the frontend must do the same).
    let budget = ComputeBudgetInstruction::set_compute_unit_limit(400_000);
    send_ixs(&mut s.svm, Base, signer, &[budget, ix])
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

#[test]
fn delegates_to_the_pinned_validator() {
    // The program picks the validator itself (ER_VALIDATOR; MagicSVM's under
    // the `localnet` feature), so a player can't send the game to a public rollup.
    let mut s = setup();
    init_game(&mut s);
    let creator = s.creator.insecure_clone();
    assert!(delegate_game(&mut s, &creator));
    let validator = s.svm.validator_identity().to_bytes();
    for acc in [s.game, s.deck, s.hand_creator, s.hand_opponent] {
        let record = s.svm
            .get_account_for(Base, &addr(delegation_record_pda_from_delegated_account(&acc)))
            .unwrap();
        // DelegationRecord: 8-byte discriminator, then the validator.
        assert_eq!(&record.data[8..40], &validator[..]);
    }
}

// ---- Rollup play + undelegate ----------------------------------------------

/// Account data as the program sees it. `get_account_for(Ephemeral, ..)`
/// hides private accounts from non-members, like the real PER RPC; these
/// assertions need to see everything, so read the rollup's store directly.
fn raw_data(svm: &MagicSVM, target: TransactionTarget, account: Pubkey) -> Vec<u8> {
    match target {
        Base => svm.get_account_for(Base, &addr(account)).unwrap().data,
        Ephemeral => svm.ephemeral().get_account(&addr(account)).unwrap().data,
    }
}

fn read_game(svm: &MagicSVM, target: TransactionTarget, game: Pubkey) -> Game {
    Game::try_deserialize(&mut raw_data(svm, target, game).as_slice()).unwrap()
}

fn start_hand(s: &mut Setup, signer: &Keypair) -> bool {
    let game = s.game;
    send(&mut s.svm, Ephemeral, signer, ix(
        instruction::StartHand {},
        accounts::StartHand { player: key(signer), game },
    ))
}

fn undelegate_game(s: &mut Setup, signer: &Keypair) -> bool {
    let (game, deck) = (s.game, s.deck);
    let (hand_creator, hand_opponent) = (s.hand_creator, s.hand_opponent);
    send(&mut s.svm, Ephemeral, signer, ix(
        instruction::UndelegateGame {},
        accounts::UndelegateGame {
            payer: key(signer),
            game,
            deck,
            hand_creator,
            hand_opponent,
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

    // A hand starts on the rollup. Solana's copy doesn't change yet.
    assert!(start_hand(&mut s, &creator));
    assert!(!start_hand(&mut s, &opponent), "hand 1 is still in progress");
    assert_eq!(read_game(&s.svm, Ephemeral, s.game).hand_number, 1);
    assert_eq!(read_game(&s.svm, Base, s.game).hand_number, 0);

    // Undelegate: data is written back and ownership returns to our program.
    assert!(undelegate_game(&mut s, &creator));
    assert_eq!(owner(&s.svm, Base, s.game), rival_river::id());
    let game = read_game(&s.svm, Base, s.game);
    assert_eq!(game.hand_number, 1);
    assert_eq!(game.players, [key(&s.creator), key(&s.opponent)]);
}

#[test]
fn stranger_cannot_play_or_undelegate() {
    let mut s = delegated();
    let stranger = Keypair::new();
    s.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();

    assert!(!start_hand(&mut s, &stranger));
    assert!(!undelegate_game(&mut s, &stranger));
    assert_eq!(owner(&s.svm, Base, s.game), Pubkey::new_from_array(DELEGATION_PROGRAM_ID.to_bytes()));
}

#[test]
fn game_is_locked_on_solana_while_delegated() {
    let mut s = delegated();
    let creator = s.creator.insecure_clone();
    // Sending start_hand to Solana instead of the rollup fails: Solana's copy is
    // owned by the delegation program, so our program can't write to it there.
    let game = s.game;
    assert!(!send(&mut s.svm, Base, &creator, ix(
        instruction::StartHand {},
        accounts::StartHand { player: key(&creator), game },
    )));
}

// ---- Starting a hand ---------------------------------------------------------

/// stacks + bets + pot: chips are never created or destroyed.
fn total_chips(g: &Game) -> u16 {
    g.stacks.iter().sum::<u16>() + g.bets.iter().sum::<u16>() + g.pot
}

#[test]
fn start_hand_posts_the_blinds() {
    let mut s = delegated();
    let opponent = s.opponent.insecure_clone();
    assert_eq!(read_game(&s.svm, Ephemeral, s.game).phase, Phase::Waiting);

    assert!(start_hand(&mut s, &opponent));
    let g = read_game(&s.svm, Ephemeral, s.game);
    assert_eq!(g.hand_number, 1);
    // Hand 1: creator has the button, posts the 5 small blind and acts first.
    assert_eq!((g.dealer, g.to_act), (0, 0));
    assert_eq!(g.bets, [5, 10]);
    assert_eq!(g.stacks, [95, 90]);
    assert_eq!(g.phase, Phase::Dealing);
    assert_eq!(total_chips(&g), 200);
}

// ---- Secrets + VRF shuffle + dealing ---------------------------------------

use {
    ephemeral_rollups_sdk::vrf::consts::{scoped_vrf_identity, DEFAULT_EPHEMERAL_QUEUE, VRF_PROGRAM_ID},
    rival_river::state::{Deck, Hand},
    solana_clock::Clock,
};

const SLOT_HASHES: Pubkey = Pubkey::from_str_const("SysvarS1otHashes111111111111111111111111111");

fn read_deck(svm: &MagicSVM, target: TransactionTarget, deck: Pubkey) -> Deck {
    Deck::try_deserialize(&mut raw_data(svm, target, deck).as_slice()).unwrap()
}

fn read_hand(svm: &MagicSVM, target: TransactionTarget, hand: Pubkey) -> Hand {
    Hand::try_deserialize(&mut raw_data(svm, target, hand).as_slice()).unwrap()
}

/// `hand` is the Hand account to write; normally the signer's own.
fn submit_secret_to(s: &mut Setup, signer: &Keypair, hand: Pubkey, secret: [u8; 32]) -> bool {
    let game = s.game;
    send(&mut s.svm, Ephemeral, signer, ix(
        instruction::SubmitSecret { secret },
        accounts::SubmitSecret { player: key(signer), game, hand },
    ))
}

fn submit_secret(s: &mut Setup, signer: &Keypair, secret: [u8; 32]) -> bool {
    let hand = pda(&[HAND_SEED, s.game.as_ref(), key(signer).as_ref()]);
    submit_secret_to(s, signer, hand, secret)
}

/// Both players submit (different) secrets.
fn both_secrets(s: &mut Setup) {
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(submit_secret(s, &creator, [0xC1; 32]));
    assert!(submit_secret(s, &opponent, [0x0B; 32]));
}

fn request_shuffle(s: &mut Setup, signer: &Keypair) -> bool {
    let (game, deck, hand_creator, hand_opponent) = (s.game, s.deck, s.hand_creator, s.hand_opponent);
    send(&mut s.svm, Ephemeral, signer, ix(
        instruction::RequestShuffle {},
        accounts::RequestShuffle {
            player: key(signer),
            game,
            deck,
            hand_creator,
            hand_opponent,
            oracle_queue: Pubkey::new_from_array(DEFAULT_EPHEMERAL_QUEUE.to_bytes()),
            program_identity: pda(&[b"identity"]),
            vrf_program: Pubkey::new_from_array(VRF_PROGRAM_ID.to_bytes()),
            slot_hashes: SLOT_HASHES,
            system_program: system_program::ID,
        },
    ))
}

/// MagicSVM plays the oracle: advancing one slot delivers pending VRF
/// callbacks. Returns how many callbacks ran, panicking if one failed.
fn fulfill(svm: &mut MagicSVM) -> usize {
    let slot = svm.get_sysvar::<Clock>().slot;
    let results = svm.warp_to_slot(slot + 1);
    for r in &results {
        if let Err(f) = r {
            panic!("callback failed: {:?}\nlogs: {:#?}", f.err, f.meta.logs);
        }
    }
    results.len()
}

/// Secrets, request, oracle answer: a full shuffle + deal.
fn shuffle_and_deal(s: &mut Setup) {
    both_secrets(s);
    let creator = s.creator.insecure_clone();
    assert!(request_shuffle(s, &creator));
    assert_eq!(fulfill(&mut s.svm), 1);
}

fn assert_full_deck(cards: [u8; 52]) {
    let mut sorted = cards;
    sorted.sort();
    assert_eq!(sorted, core::array::from_fn(|i| i as u8), "not a permutation of 0..52");
}

#[test]
fn shuffle_deals_two_cards_to_each_player() {
    let mut s = private();
    both_secrets(&mut s);
    let creator = s.creator.insecure_clone();

    assert!(request_shuffle(&mut s, &creator));
    // Step 1 done, the oracle hasn't answered yet.
    let deck = read_deck(&s.svm, Ephemeral, s.deck);
    assert!(deck.pending && !deck.shuffled);

    // Step 2: the oracle answers, the VRF program calls callback_shuffle.
    assert_eq!(fulfill(&mut s.svm), 1);
    let deck = read_deck(&s.svm, Ephemeral, s.deck);
    assert!(deck.shuffled && !deck.pending);
    assert_full_deck(deck.cards);
    assert_ne!(deck.cards, core::array::from_fn(|i| i as u8), "deck wasn't shuffled");
    assert_eq!(read_game(&s.svm, Ephemeral, s.game).phase, Phase::Preflop);

    // Dealt alternately from the top; the board will start at card 4.
    let (c, o) = (read_hand(&s.svm, Ephemeral, s.hand_creator), read_hand(&s.svm, Ephemeral, s.hand_opponent));
    assert!(c.dealt && o.dealt);
    assert_eq!(c.cards, [deck.cards[0], deck.cards[2]]);
    assert_eq!(o.cards, [deck.cards[1], deck.cards[3]]);
    assert_eq!(deck.next, 4);

    // Secrets are used up and wiped.
    for h in [c, o] {
        assert!(!h.has_secret);
        assert_eq!(h.secret, [0; 32]);
    }
}

#[test]
fn shuffle_waits_for_both_secrets() {
    let mut s = private();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());

    assert!(!request_shuffle(&mut s, &creator), "no secrets yet");
    assert!(submit_secret(&mut s, &creator, [1; 32]));
    assert!(!request_shuffle(&mut s, &creator), "only one secret");
    assert!(submit_secret(&mut s, &opponent, [2; 32]));
    assert!(request_shuffle(&mut s, &creator));
}

#[test]
fn secret_cannot_be_changed_once_submitted() {
    let mut s = private();
    let creator = s.creator.insecure_clone();
    assert!(submit_secret(&mut s, &creator, [1; 32]));
    assert!(!submit_secret(&mut s, &creator, [9; 32]));
    assert_eq!(read_hand(&s.svm, Ephemeral, s.hand_creator).secret, [1; 32]);
}

#[test]
fn player_cannot_write_the_other_players_hand() {
    let mut s = private();
    let creator = s.creator.insecure_clone();
    let theirs = s.hand_opponent;
    assert!(!submit_secret_to(&mut s, &creator, theirs, [7; 32]));
    assert!(!read_hand(&s.svm, Ephemeral, s.hand_opponent).has_secret);
}

#[test]
fn only_one_shuffle_at_a_time() {
    let mut s = private();
    both_secrets(&mut s);
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(request_shuffle(&mut s, &creator));
    assert!(!request_shuffle(&mut s, &opponent), "callback hasn't arrived yet");
}

#[test]
fn shuffle_needs_a_started_hand() {
    let mut s = delegated();
    let creator = s.creator.insecure_clone();
    assert!(init_permissions(&mut s, &creator));
    both_secrets(&mut s);
    assert!(!request_shuffle(&mut s, &creator), "no blinds posted yet");
    assert!(start_hand(&mut s, &creator));
    assert!(request_shuffle(&mut s, &creator));
}

#[test]
fn no_reshuffle_mid_hand() {
    let mut s = private();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    shuffle_and_deal(&mut s);
    let dealt = read_deck(&s.svm, Ephemeral, s.deck).cards;

    // Even with fresh secrets from both, the hand's cards can't be redrawn.
    both_secrets(&mut s);
    assert!(!request_shuffle(&mut s, &opponent));
    assert!(!start_hand(&mut s, &creator), "hand 1 is still in progress");
    assert_eq!(read_deck(&s.svm, Ephemeral, s.deck).cards, dealt);
}

#[test]
fn stranger_cannot_submit_a_secret_or_request_a_shuffle() {
    let mut s = private();
    let stranger = Keypair::new();
    s.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let hand = s.hand_creator;
    assert!(!submit_secret_to(&mut s, &stranger, hand, [3; 32]));
    both_secrets(&mut s);
    assert!(!request_shuffle(&mut s, &stranger));
}

#[test]
fn nobody_can_call_the_callback_with_their_own_randomness() {
    let mut s = private();
    both_secrets(&mut s);
    let attacker = s.creator.insecure_clone();
    let (game, deck, hand_creator, hand_opponent) = (s.game, s.deck, s.hand_creator, s.hand_opponent);

    // Pretend to be the VRF program: wrong signer.
    assert!(!send(&mut s.svm, Ephemeral, &attacker, ix(
        instruction::CallbackShuffle { randomness: [0u8; 32] },
        accounts::CallbackShuffle { game, deck, hand_creator, hand_opponent, vrf_program_identity: key(&attacker) },
    )));
    // Name the real VRF identity without its signature: must fail too.
    let mut forged = ix(
        instruction::CallbackShuffle { randomness: [0u8; 32] },
        accounts::CallbackShuffle {
            game,
            deck,
            hand_creator,
            hand_opponent,
            vrf_program_identity: scoped_vrf_identity(&rival_river::id()),
        },
    );
    let identity = addr(scoped_vrf_identity(&rival_river::id()));
    forged.accounts.iter_mut().filter(|m| m.pubkey == identity).for_each(|m| m.is_signer = false);
    assert!(!send(&mut s.svm, Ephemeral, &attacker, forged));
    assert!(!read_deck(&s.svm, Ephemeral, s.deck).shuffled);
    assert!(!read_hand(&s.svm, Ephemeral, s.hand_creator).dealt);
}

// ---- Private accounts: permissions ------------------------------------------

use ephemeral_rollups_sdk::{
    access_control::structs::{EphemeralPermission, AUTHORITY_FLAG},
    consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
};

fn permission_of(account: Pubkey) -> Pubkey {
    EphemeralPermission::find_pda(&account).0
}

fn init_permissions(s: &mut Setup, signer: &Keypair) -> bool {
    let p = [s.game, s.deck, s.hand_creator, s.hand_opponent].map(permission_of);
    init_permissions_with(s, signer, p)
}

/// Permission accounts to pass for Game, Deck, creator Hand, opponent Hand.
/// Normally each account's own; tests pass wrong ones to check they're refused.
fn init_permissions_with(s: &mut Setup, signer: &Keypair, permissions: [Pubkey; 4]) -> bool {
    let (game, deck, hand_creator, hand_opponent) = (s.game, s.deck, s.hand_creator, s.hand_opponent);
    let [game_permission, deck_permission, hand_creator_permission, hand_opponent_permission] = permissions;
    send(&mut s.svm, Ephemeral, signer, ix(
        instruction::InitPermissions {},
        accounts::InitPermissions {
            payer: key(signer),
            game,
            deck,
            hand_creator,
            hand_opponent,
            game_permission,
            deck_permission,
            hand_creator_permission,
            hand_opponent_permission,
            permission_program: PERMISSION_PROGRAM_ID,
            ephemeral_vault: EPHEMERAL_VAULT_ID,
            magic_program: MAGIC_PROGRAM_ID,
        },
    ))
}

/// delegated() + init_permissions + start_hand: hand 1's blinds are posted,
/// ready for secrets and the shuffle.
fn private() -> Setup {
    let mut s = delegated();
    let creator = s.creator.insecure_clone();
    assert!(init_permissions(&mut s, &creator));
    assert!(start_hand(&mut s, &creator));
    s
}

#[test]
fn init_permissions_rejects_a_reused_permission() {
    let mut s = delegated();
    let creator = s.creator.insecure_clone();
    let game_permission = permission_of(s.game);
    // The attack: Game's permission is created first, then the Deck and Hand
    // slots see an existing permission and skip, leaving them public.
    assert!(!init_permissions_with(&mut s, &creator, [game_permission; 4]));
    assert!(s.svm.get_account_for(Ephemeral, &addr(game_permission)).is_none());
}

#[test]
fn each_player_reads_only_their_own_hand() {
    let mut s = private();
    let (c, o) = (s.creator.pubkey(), s.opponent.pubkey());
    let (game, deck, hand_c, hand_o) = (s.game, s.deck, s.hand_creator, s.hand_opponent);
    // What the rollup's RPC would return to `viewer` (None = not logged in).
    let mut can_read = |viewer: Option<Address>, account: Pubkey| {
        s.svm.set_authorized_user(viewer);
        s.svm.get_account_for(Ephemeral, &addr(account)).is_some()
    };
    for viewer in [None, Some(c), Some(o)] {
        assert!(!can_read(viewer, deck), "nobody reads the Deck");
    }
    assert!(can_read(Some(c), hand_c));
    assert!(!can_read(Some(o), hand_c));
    assert!(can_read(Some(o), hand_o));
    assert!(!can_read(Some(c), hand_o));
    assert!(can_read(Some(c), game) && can_read(Some(o), game));
    assert!(!can_read(None, game), "Game is private to the two players");
}

#[test]
fn no_secrets_before_permissions() {
    let mut s = delegated();
    let creator = s.creator.insecure_clone();
    assert!(!submit_secret(&mut s, &creator, [1; 32]), "Hand is still public");
    assert!(init_permissions(&mut s, &creator));
    assert!(read_game(&s.svm, Ephemeral, s.game).permissions_ready);
    assert!(submit_secret(&mut s, &creator, [1; 32]));
}

/// (is_private, member pubkeys, any member has AUTHORITY_FLAG) for an account's
/// permission on the rollup. The permission program always lists the owning
/// program (ours) first, with no flags; programs can't log in to the RPC, so
/// it can't read anything. It's left out of the returned list.
fn readers(svm: &MagicSVM, account: Pubkey) -> (bool, Vec<Pubkey>, bool) {
    let acc = svm
        .get_account_for(Ephemeral, &addr(permission_of(account)))
        .expect("permission account missing on the rollup");
    assert_eq!(acc.owner.to_bytes(), PERMISSION_PROGRAM_ID.to_bytes());
    let p = EphemeralPermission::from_bytes(&acc.data).unwrap();
    assert_eq!(p.permissioned_account, account);
    let (default, rest) = p.members.split_first().expect("default member");
    assert_eq!((default.pubkey, default.flags), (rival_river::id(), 0));
    let members = rest.iter().map(|m| m.pubkey).collect();
    let authority = rest.iter().any(|m| m.flags & AUTHORITY_FLAG != 0);
    (p.private, members, authority)
}

#[test]
fn permissions_give_each_account_the_right_readers() {
    let mut s = delegated();
    let creator = s.creator.insecure_clone();
    assert!(init_permissions(&mut s, &creator));

    let (c, o) = (key(&s.creator), key(&s.opponent));
    assert_eq!(readers(&s.svm, s.game), (true, vec![c, o], false), "Game: both players");
    assert_eq!(readers(&s.svm, s.deck), (true, vec![], false), "Deck: nobody");
    assert_eq!(readers(&s.svm, s.hand_creator), (true, vec![c], false), "creator's Hand");
    assert_eq!(readers(&s.svm, s.hand_opponent), (true, vec![o], false), "opponent's Hand");
}

#[test]
fn init_permissions_can_be_retried() {
    let mut s = delegated();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(init_permissions(&mut s, &creator));
    assert!(init_permissions(&mut s, &opponent));
    assert_eq!(readers(&s.svm, s.deck), (true, vec![], false));
}

#[test]
fn stranger_cannot_init_permissions() {
    let mut s = delegated();
    let stranger = Keypair::new();
    s.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    assert!(!init_permissions(&mut s, &stranger));
    assert!(s.svm.get_account_for(Ephemeral, &addr(permission_of(s.deck))).is_none());
}

#[test]
fn hands_round_trip_with_permissions_in_place() {
    let mut s = delegated();
    let creator = s.creator.insecure_clone();
    assert!(init_permissions(&mut s, &creator));
    assert!(undelegate_game(&mut s, &creator));
    for acc in [s.game, s.deck, s.hand_creator, s.hand_opponent] {
        assert_eq!(owner(&s.svm, Base, acc), rival_river::id());
    }
}

// ---- Undelegate wipes secrets -------------------------------------------------

/// Everything that came back to Solana is public, so nothing secret may be in it.
fn assert_nothing_secret_on_solana(s: &Setup) {
    let deck = read_deck(&s.svm, Base, s.deck);
    assert_eq!(deck.cards, [0; 52], "deck order leaked");
    assert!(!deck.shuffled && !deck.pending);
    for hand in [s.hand_creator, s.hand_opponent] {
        let h = read_hand(&s.svm, Base, hand);
        assert_eq!(h.cards, [0; 2], "hole cards leaked");
        assert_eq!(h.secret, [0; 32], "secret leaked");
        assert!(!h.dealt && !h.has_secret);
    }
    assert!(!read_game(&s.svm, Base, s.game).permissions_ready);
}

#[test]
fn undelegate_after_a_deal_leaves_no_cards_on_solana() {
    let mut s = private();
    let creator = s.creator.insecure_clone();
    shuffle_and_deal(&mut s);
    assert!(undelegate_game(&mut s, &creator));
    assert_nothing_secret_on_solana(&s);

    // The hand can't finish without its cards: called off, blinds returned.
    let g = read_game(&s.svm, Base, s.game);
    assert_eq!(g.phase, Phase::Waiting);
    assert_eq!((g.stacks, g.bets, g.pot), ([100, 100], [0, 0], 0));
    assert_eq!(g.hand_number, 1, "a called-off hand still counts");
}

#[test]
fn undelegate_mid_shuffle_leaves_no_secrets_on_solana() {
    let mut s = private();
    let creator = s.creator.insecure_clone();
    // Secrets are in, the oracle hasn't answered: the worst moment to leave.
    both_secrets(&mut s);
    assert!(request_shuffle(&mut s, &creator));
    assert!(undelegate_game(&mut s, &creator));
    assert_nothing_secret_on_solana(&s);
}

// ---- Betting: act -------------------------------------------------------------

use rival_river::{poker, Action};

fn act(s: &mut Setup, signer: &Keypair, action: Action) -> bool {
    let (game, deck, hand_creator, hand_opponent) = (s.game, s.deck, s.hand_creator, s.hand_opponent);
    send(&mut s.svm, Ephemeral, signer, ix(
        instruction::Act { action },
        accounts::Act { player: key(signer), game, deck, hand_creator, hand_opponent },
    ))
}

/// private() + shuffle: hand 1 preflop. Creator is the button (small blind)
/// and acts first.
fn preflop() -> Setup {
    let mut s = private();
    shuffle_and_deal(&mut s);
    s
}

/// Showdown scores [creator, opponent] for the current deck, computed the
/// same way the program should.
fn scores(s: &Setup) -> [u32; 2] {
    let board: [u8; 5] = read_deck(&s.svm, Ephemeral, s.deck).cards[4..9].try_into().unwrap();
    [s.hand_creator, s.hand_opponent].map(|h| {
        let cards = read_hand(&s.svm, Ephemeral, h).cards;
        let mut seven = [0u8; 7];
        seven[..2].copy_from_slice(&cards);
        seven[2..].copy_from_slice(&board);
        poker::best_of_seven(seven)
    })
}

#[test]
fn fold_gives_the_pot_to_the_other_player() {
    let mut s = preflop();
    let creator = s.creator.insecure_clone();
    assert!(act(&mut s, &creator, Action::Fold));
    let g = read_game(&s.svm, Ephemeral, s.game);
    assert_eq!(g.stacks, [95, 105]);
    assert_eq!((g.pot, g.bets), (0, [0, 0]));
    assert_eq!(g.phase, Phase::Waiting);
    assert_eq!(g.shown, None, "folded hands stay hidden");
}

#[test]
fn turn_order_is_enforced() {
    let mut s = preflop();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    let stranger = Keypair::new();
    s.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    assert!(!act(&mut s, &opponent, Action::Call), "button acts first preflop");
    assert!(!act(&mut s, &stranger, Action::Fold));
    assert!(act(&mut s, &creator, Action::Call));
    assert!(!act(&mut s, &creator, Action::Check), "now it's the big blind's option");
}

#[test]
fn illegal_actions_are_refused() {
    let mut s = preflop();
    let creator = s.creator.insecure_clone();
    assert!(!act(&mut s, &creator, Action::Check), "5 to call");
    assert!(!act(&mut s, &creator, Action::Raise { to: 15 }), "raise by 5 < big blind");
    assert!(!act(&mut s, &creator, Action::Raise { to: 101 }), "more than the stack");
    assert!(act(&mut s, &creator, Action::Raise { to: 20 }));
    assert_eq!(read_game(&s.svm, Ephemeral, s.game).min_raise, 10);
}

#[test]
fn reraise_must_match_the_last_raise() {
    let mut s = preflop();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(act(&mut s, &creator, Action::Raise { to: 40 })); // raise by 30
    assert!(!act(&mut s, &opponent, Action::Raise { to: 60 }), "raise by 20 < 30");
    assert!(act(&mut s, &opponent, Action::Raise { to: 70 }));
    let g = read_game(&s.svm, Ephemeral, s.game);
    assert_eq!((g.bets, g.min_raise, g.to_act), ([40, 70], 30, 0));
}

#[test]
fn checked_down_hand_reaches_showdown() {
    let mut s = preflop();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    let deck = read_deck(&s.svm, Ephemeral, s.deck).cards;

    assert!(act(&mut s, &creator, Action::Call)); // limp
    assert!(act(&mut s, &opponent, Action::Check)); // big blind checks its option
    for (phase, shown) in [(Phase::Flop, 3), (Phase::Turn, 4), (Phase::River, 5)] {
        let g = read_game(&s.svm, Ephemeral, s.game);
        assert_eq!(g.phase, phase);
        assert_eq!(g.board[..shown], deck[4..4 + shown]);
        assert_eq!((g.pot, g.bets, g.to_act), (20, [0, 0], 1), "out of position acts first");
        assert_eq!(total_chips(&g), 200);
        assert!(act(&mut s, &opponent, Action::Check));
        assert!(act(&mut s, &creator, Action::Check));
    }

    let g = read_game(&s.svm, Ephemeral, s.game);
    assert_eq!(g.phase, Phase::Waiting);
    assert_eq!(total_chips(&g), 200);
    let [c, o] = scores(&s);
    let expected = match c.cmp(&o) {
        std::cmp::Ordering::Greater => [110, 90],
        std::cmp::Ordering::Less => [90, 110],
        std::cmp::Ordering::Equal => [100, 100],
    };
    assert_eq!(g.stacks, expected);
    let hands = [s.hand_creator, s.hand_opponent].map(|h| read_hand(&s.svm, Ephemeral, h).cards);
    assert_eq!(g.shown, Some(hands));
}

#[test]
fn all_in_preflop_runs_out_the_board() {
    let mut s = preflop();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(act(&mut s, &creator, Action::Raise { to: 100 }));
    assert!(!act(&mut s, &opponent, Action::Raise { to: 100 }), "can't raise an all-in");
    assert!(act(&mut s, &opponent, Action::Call));

    let g = read_game(&s.svm, Ephemeral, s.game);
    assert_eq!(g.board, read_deck(&s.svm, Ephemeral, s.deck).cards[4..9]);
    assert_eq!(total_chips(&g), 200);
    let [c, o] = scores(&s);
    match c.cmp(&o) {
        std::cmp::Ordering::Greater => assert_eq!((g.stacks, g.winner, g.phase), ([200, 0], Some(0), Phase::Finished)),
        std::cmp::Ordering::Less => assert_eq!((g.stacks, g.winner, g.phase), ([0, 200], Some(1), Phase::Finished)),
        std::cmp::Ordering::Equal => assert_eq!((g.stacks, g.winner, g.phase), ([100, 100], None, Phase::Waiting)),
    }
    assert!(!act(&mut s, &creator, Action::Check), "no betting after the hand");
}

#[test]
fn each_hand_gets_a_new_deck_and_needs_new_secrets() {
    let mut s = preflop();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    let first = read_deck(&s.svm, Ephemeral, s.deck).cards;
    assert!(act(&mut s, &creator, Action::Fold));

    assert!(start_hand(&mut s, &opponent));
    let g = read_game(&s.svm, Ephemeral, s.game);
    // Hand 2: the button moves to the opponent; blinds 10/20.
    assert_eq!((g.hand_number, g.dealer, g.to_act), (2, 1, 1));
    assert_eq!(g.bets, [20, 10]);
    assert!(!request_shuffle(&mut s, &creator), "last hand's secrets are used up");

    shuffle_and_deal(&mut s);
    let second = read_deck(&s.svm, Ephemeral, s.deck).cards;
    assert_full_deck(second);
    assert_ne!(first, second);
    assert!(act(&mut s, &opponent, Action::Call), "opponent has the button now");
}

// ---- Settling the match on Solana ----------------------------------------------

use rival_river::state::{Table, TableStatus};

fn read_table(svm: &MagicSVM, table: Pubkey) -> Table {
    Table::try_deserialize(&mut raw_data(svm, Base, table).as_slice()).unwrap()
}

/// Sent to Solana by anyone (here: a stranger) to pay `to` the vault.
fn settle(s: &mut Setup, to: Pubkey) -> bool {
    let payer = Keypair::new();
    s.svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let (table, game, mint, creator) = (s.table, s.game, s.mint, key(&s.creator));
    send(&mut s.svm, Base, &payer, ix(
        instruction::Settle {},
        accounts::Settle {
            table,
            game,
            mint,
            winner_token: to,
            vault: ata(table, mint),
            creator,
            token_program: token_program(),
        },
    ))
}

/// Deals a hand and has each player shove or call until it's over.
fn play_all_in_hand(s: &mut Setup) {
    shuffle_and_deal(s);
    let players = [s.creator.insecure_clone(), s.opponent.insecure_clone()];
    loop {
        let g = read_game(&s.svm, Ephemeral, s.game);
        if !matches!(g.phase, Phase::Preflop | Phase::Flop | Phase::Turn | Phase::River) {
            return;
        }
        let (me, other) = (g.to_act as usize, 1 - g.to_act as usize);
        let shove = g.bets[me] + g.stacks[me];
        let action = if g.stacks[other] > 0 && shove > g.bets[other] {
            Action::Raise { to: shove }
        } else if g.bets[other] > g.bets[me] {
            Action::Call
        } else {
            Action::Check
        };
        assert!(act(s, &players[me], action), "{action:?} refused");
    }
}

#[test]
fn winner_takes_both_stakes() {
    let mut s = private();
    let creator = s.creator.insecure_clone();
    // Split pots don't end the match: keep shoving until someone busts.
    for _ in 0..10 {
        play_all_in_hand(&mut s);
        if read_game(&s.svm, Ephemeral, s.game).phase == Phase::Finished {
            break;
        }
        assert!(start_hand(&mut s, &creator));
    }
    let vault = ata(s.table, s.mint);
    let tokens = [key(&s.creator), key(&s.opponent)].map(|p| ata(p, s.mint));
    assert_eq!(balance(&s.svm, vault), Some(2 * STAKE));
    assert_eq!(tokens.map(|t| balance(&s.svm, t)), [Some(0), Some(0)]);

    // Still on the rollup: Solana's Game copy is stale and owned by the
    // delegation program, so settle refuses.
    let winner = read_game(&s.svm, Ephemeral, s.game).winner.expect("someone busted") as usize;
    assert!(!settle(&mut s, tokens[winner]));

    assert!(undelegate_game(&mut s, &creator));
    assert_eq!(read_game(&s.svm, Base, s.game).winner, Some(winner as u8));
    assert!(!settle(&mut s, tokens[1 - winner]), "loser can't be paid");
    assert!(settle(&mut s, tokens[winner]));

    assert_eq!(balance(&s.svm, tokens[winner]), Some(2 * STAKE));
    assert_eq!(balance(&s.svm, tokens[1 - winner]), Some(0));
    assert_eq!(balance(&s.svm, vault), None, "vault closed");
    assert_eq!(read_table(&s.svm, s.table).status, TableStatus::Settled);
    assert!(!settle(&mut s, tokens[winner]), "only once");
}

#[test]
fn cannot_settle_an_unfinished_match() {
    let mut s = preflop();
    let creator = s.creator.insecure_clone();
    assert!(act(&mut s, &creator, Action::Fold));
    assert!(undelegate_game(&mut s, &creator));
    let creator_token = ata(key(&s.creator), s.mint);
    assert!(!settle(&mut s, creator_token));
    assert_eq!(balance(&s.svm, ata(s.table, s.mint)), Some(2 * STAKE));
}
