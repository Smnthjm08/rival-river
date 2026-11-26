//! Rollup tests. MagicSVM runs Solana ("Base") and the ephemeral rollup
//! ("Ephemeral") in one process, so delegation can be tested without validators.
//! Run with `cargo test` from this folder (rust-toolchain.toml picks the
//! newer rustc), after `anchor build -- --features localnet`.
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
/// Locked. Does NOT run init_game. No session keys named at stake time.
fn setup() -> Setup {
    setup_with([Pubkey::default(); 2])
}

/// setup(), with each player naming a session key when they stake
/// ([creator's, opponent's]), as the app does.
fn setup_with(sessions: [Pubkey; 2]) -> Setup {
    setup_full(sessions, false)
}

/// With `open`: the creator names no opponent, only an invite key, and the
/// opponent joins by co-signing with it (the invite link's keypair).
fn setup_full(sessions: [Pubkey; 2], open: bool) -> Setup {
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
    let invite = Keypair::new();
    assert!(send(&mut svm, Base, &creator, ix(
        instruction::CreateTable {
            table_id: 1,
            opponent: if open { Pubkey::default() } else { key(&opponent) },
            stake: STAKE,
            session_key: sessions[0],
            invite_key: if open { key(&invite) } else { Pubkey::default() },
        },
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
    let join = ix(
        instruction::JoinTable { session_key: sessions[1], stake: STAKE },
        accounts::JoinTable {
            opponent: key(&opponent),
            invite: open.then(|| key(&invite)),
            table,
            mint,
            opponent_token: ata(key(&opponent), mint),
            vault,
            token_program: token_program(),
        },
    );
    let signers: Vec<&Keypair> = if open { vec![&opponent, &invite] } else { vec![&opponent] };
    let tx = Transaction::new(&signers, Message::new(&[join], Some(&opponent.pubkey())), svm.latest_blockhash_for(Base));
    assert!(svm.send_transaction_to(Base, tx).is_ok(), "join_table");
    svm.expire_blockhash_for(Base);
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

/// A fake USDC mint at the address the program requires (82-byte SPL Mint, 6 decimals).
fn create_mint(svm: &mut MagicSVM) -> Pubkey {
    let mint = rival_river::constants::USDC_MINT;
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
    let creator = s.creator.insecure_clone();
    init_game_by(s, &creator);
}

fn init_game_by(s: &mut Setup, signer: &Keypair) {
    assert!(send(&mut s.svm, Base, signer, ix(
        instruction::InitGame {},
        accounts::InitGame {
            payer: key(signer),
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
    let ixs = delegate_game_ixs(s, signer);
    send_ixs(&mut s.svm, Base, signer, &ixs)
}

/// The program's error name if the transaction fails, e.g. "MatchFinished".
fn error_name(svm: &mut MagicSVM, target: TransactionTarget, signer: &Keypair, ixs: &[Instruction]) -> Option<String> {
    let msg = Message::new(ixs, Some(&signer.pubkey()));
    let tx = Transaction::new(&[signer], msg, svm.latest_blockhash_for(target));
    let res = svm.send_transaction_to(target, tx);
    svm.expire_blockhash_for(target);
    let logs = res.err()?.meta.logs;
    Some(logs.iter().find_map(|l| Some(l.split("Error Code: ").nth(1)?.split('.').next()?.to_string()))
        .unwrap_or_else(|| format!("{logs:?}")))
}

fn delegate_game_ixs(s: &Setup, signer: &Keypair) -> Vec<Instruction> {
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
    vec![budget, ix]
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
    let ix = undelegate_game_ix(s, signer);
    send(&mut s.svm, Ephemeral, signer, ix)
}

fn undelegate_game_ix(s: &Setup, signer: &Keypair) -> Instruction {
    let (game, deck) = (s.game, s.deck);
    let (hand_creator, hand_opponent) = (s.hand_creator, s.hand_opponent);
    ix(
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
    )
}

/// Ends the match on the rollup (creator wins) without playing it out:
/// undelegate_game only works on a finished match.
fn force_finish(s: &mut Setup) {
    let game = s.game;
    edit_ephemeral::<Game>(s, game, |g| {
        g.phase = Phase::Finished;
        g.winner = Some(0);
    });
}

/// delegated_empty() with both players checked in, ready for play.
fn delegated() -> Setup {
    let mut s = delegated_empty();
    check_in_both(&mut s);
    s
}

fn check_in(s: &mut Setup, signer: &Keypair) -> bool {
    let game = s.game;
    send(&mut s.svm, Ephemeral, signer, ix(
        instruction::CheckIn {},
        accounts::CheckIn { player: key(signer), game },
    ))
}

fn check_in_both(s: &mut Setup) {
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(check_in(s, &creator));
    assert!(check_in(s, &opponent));
}

/// init_game + delegate_game: on the rollup, nobody checked in yet.
fn delegated_empty() -> Setup {
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

    // Undelegate (once the match is over): data is written back and
    // ownership returns to our program.
    assert!(!undelegate_game(&mut s, &creator), "match still in progress");
    force_finish(&mut s);
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
        instruction::CallbackShuffle { randomness: [0u8; 32], hand_number: 1 },
        accounts::CallbackShuffle { game, deck, hand_creator, hand_opponent, vrf_program_identity: key(&attacker) },
    )));
    // Name the real VRF identity without its signature: must fail too.
    let mut forged = ix(
        instruction::CallbackShuffle { randomness: [0u8; 32], hand_number: 1 },
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

/// (member, flags) for an account's permission, without the program's default entry.
fn member_flags(svm: &MagicSVM, account: Pubkey) -> Vec<(Pubkey, u8)> {
    let acc = svm.get_account_for(Ephemeral, &addr(permission_of(account))).unwrap();
    let p = EphemeralPermission::from_bytes(&acc.data).unwrap();
    p.members[1..].iter().map(|m| (m.pubkey, m.flags)).collect()
}

#[test]
fn players_see_game_data_but_not_its_transactions() {
    use ephemeral_rollups_sdk::access_control::structs::{TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG};
    let mut s = delegated();
    let creator = s.creator.insecure_clone();
    assert!(init_permissions(&mut s, &creator));
    let (c, o) = (key(&s.creator), key(&s.opponent));
    // Every transaction includes Game, so transaction flags here could show a
    // player the other's submit_secret data. Membership alone gives reads.
    assert_eq!(member_flags(&s.svm, s.game), vec![(c, 0), (o, 0)]);
    let own = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
    assert_eq!(member_flags(&s.svm, s.hand_creator), vec![(c, own)]);
    assert_eq!(member_flags(&s.svm, s.hand_opponent), vec![(o, own)]);
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
    force_finish(&mut s);
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
fn undelegate_leaves_no_cards_or_secrets_on_solana() {
    let mut s = finished(); // the last hand's cards are still in Deck and Hands
    let creator = s.creator.insecure_clone();
    // A secret submitted after the end, for a shuffle that will never run.
    assert!(submit_secret(&mut s, &creator, [0xAB; 32]));
    assert!(undelegate_game(&mut s, &creator));
    assert_nothing_secret_on_solana(&s);
}

#[test]
fn cannot_undelegate_to_escape_a_hand() {
    let mut s = preflop();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(act(&mut s, &creator, Action::Raise { to: 50 }));
    assert!(act(&mut s, &opponent, Action::Call));
    // Opponent doesn't like the flop. Leaving would hand back their 50.
    assert!(!undelegate_game(&mut s, &opponent));
    assert!(!undelegate_game(&mut s, &creator));
    let g = read_game(&s.svm, Ephemeral, s.game);
    assert_eq!((g.phase, g.pot, g.stacks), (Phase::Flop, 100, [50, 50]));
    assert_eq!(owner(&s.svm, Base, s.game), Pubkey::new_from_array(DELEGATION_PROGRAM_ID.to_bytes()));
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
    let (deck, hand_creator, hand_opponent) = (s.deck, s.hand_creator, s.hand_opponent);
    send(&mut s.svm, Base, &payer, ix(
        instruction::Settle {},
        accounts::Settle {
            table,
            game,
            deck,
            hand_creator,
            hand_opponent,
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
    let before = match_accounts(&s);
    let rent: u64 = [s.table, vault].iter().map(|a| s.svm.get_balance(&addr(*a)).unwrap()).sum();
    let creator_before = s.svm.get_balance(&creator.pubkey()).unwrap();
    assert!(settle(&mut s, tokens[winner]));
    assert_eq!(match_accounts(&s), before, "the match accounts stay, untouched");
    assert_eq!(s.svm.get_balance(&creator.pubkey()).unwrap(), creator_before + rent);

    assert_eq!(balance(&s.svm, tokens[winner]), Some(2 * STAKE));
    assert_eq!(balance(&s.svm, tokens[1 - winner]), Some(0));
    assert_eq!(balance(&s.svm, vault), None, "vault closed");
    assert!(closed(&s, s.table), "table closed too");
    assert!(!settle(&mut s, tokens[winner]), "only once");
}

#[test]
fn cannot_settle_an_unfinished_match() {
    let mut s = setup();
    init_game(&mut s); // on Solana, owned by the program, phase Waiting
    let creator_token = ata(key(&s.creator), s.mint);
    assert!(!settle(&mut s, creator_token));
    assert_eq!(balance(&s.svm, ata(s.table, s.mint)), Some(2 * STAKE));
}

// ---- VRF answers are tied to their request ------------------------------------

use anchor_lang::AccountSerialize;

/// Rewrites a rollup account in place, to set up states that are hard to reach
/// (e.g. a request that was overtaken by events before the oracle answered).
fn edit_ephemeral<T: AccountDeserialize + AccountSerialize>(s: &mut Setup, account: Pubkey, f: impl FnOnce(&mut T)) {
    let mut acc = s.svm.ephemeral().get_account(&addr(account)).unwrap();
    let mut value = T::try_deserialize(&mut acc.data.as_slice()).unwrap();
    f(&mut value);
    let mut data = Vec::new();
    value.try_serialize(&mut data).unwrap();
    acc.data[..data.len()].copy_from_slice(&data);
    s.svm.ephemeral_mut().set_account(addr(account), acc).unwrap();
}

/// Lets the oracle answer; returns whether its callback succeeded.
fn oracle_answers(s: &mut Setup) -> bool {
    let slot = s.svm.get_sysvar::<Clock>().slot;
    let results = s.svm.warp_to_slot(slot + 1);
    assert_eq!(results.len(), 1, "one request was queued");
    results[0].is_ok()
}

/// Secrets in, shuffle requested, oracle not answered yet.
fn requested() -> Setup {
    let mut s = private();
    let creator = s.creator.insecure_clone();
    both_secrets(&mut s);
    assert!(request_shuffle(&mut s, &creator));
    s
}

fn assert_not_dealt(s: &Setup) {
    assert!(!read_deck(&s.svm, Ephemeral, s.deck).shuffled);
    assert!(!read_hand(&s.svm, Ephemeral, s.hand_creator).dealt);
    assert!(!read_hand(&s.svm, Ephemeral, s.hand_opponent).dealt);
}

#[test]
fn answer_for_an_earlier_hand_is_refused() {
    let mut s = requested();
    // The game moved on to hand 2 before hand 1's answer arrived.
    let game = s.game;
    edit_ephemeral::<Game>(&mut s, game, |g| g.hand_number = 2);
    assert!(!oracle_answers(&mut s));
    assert_not_dealt(&s);
}

#[test]
fn answer_without_an_open_request_is_refused() {
    let mut s = requested();
    // As undelegate leaves it: request cleared, answer still on its way.
    let deck = s.deck;
    edit_ephemeral::<Deck>(&mut s, deck, |d| d.pending = false);
    assert!(!oracle_answers(&mut s));
    assert_not_dealt(&s);
}

#[test]
fn answer_cannot_redeal_a_hand_in_play() {
    let mut s = requested();
    let game = s.game;
    edit_ephemeral::<Game>(&mut s, game, |g| g.phase = Phase::Flop);
    assert!(!oracle_answers(&mut s));
    assert_not_dealt(&s);
}

#[test]
fn answer_for_this_hand_deals() {
    let mut s = requested();
    assert!(oracle_answers(&mut s));
    assert_eq!(read_game(&s.svm, Ephemeral, s.game).phase, Phase::Preflop);
}

// ---- Delegation lifecycle -------------------------------------------------------

/// private() played to the end with all-in hands: Phase::Finished on the rollup.
fn finished() -> Setup {
    let mut s = private();
    let creator = s.creator.insecure_clone();
    for _ in 0..10 {
        play_all_in_hand(&mut s);
        if read_game(&s.svm, Ephemeral, s.game).phase == Phase::Finished {
            return s;
        }
        assert!(start_hand(&mut s, &creator));
    }
    panic!("nobody busted in 10 all-in hands");
}

#[test]
fn finished_game_cannot_be_delegated_again() {
    let mut s = finished();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(undelegate_game(&mut s, &creator));
    // The loser tries to lock the game again before anyone settles.
    for player in [&opponent, &creator] {
        let ixs = delegate_game_ixs(&s, player);
        assert_eq!(error_name(&mut s.svm, Base, player, &ixs).as_deref(), Some("MatchFinished"));
    }
    assert_eq!(owner(&s.svm, Base, s.game), rival_river::id(), "still settleable");
}

#[test]
fn settled_table_cannot_be_delegated() {
    let mut s = finished();
    let creator = s.creator.insecure_clone();
    assert!(undelegate_game(&mut s, &creator));
    let winner = read_game(&s.svm, Base, s.game).winner.unwrap() as usize;
    let winner_token = ata([key(&s.creator), key(&s.opponent)][winner], s.mint);
    assert!(settle(&mut s, winner_token));
    let ixs = delegate_game_ixs(&s, &creator);
    assert!(error_name(&mut s.svm, Base, &creator, &ixs).is_some(), "the table is gone");
}

/// The rollup judges who may read a past transaction by these permissions,
/// so closing them would publish both secrets and the shuffle randomness.
/// (MagicSVM doesn't model that history filter: scripts/smoke-devnet.ts
/// checks it against the real TEE.)
#[test]
fn undelegate_keeps_the_permissions() {
    let mut s = private();
    let accounts = [s.game, s.deck, s.hand_creator, s.hand_opponent];
    let before = accounts.map(|a| readers(&s.svm, a));

    force_finish(&mut s);
    let creator = s.creator.insecure_clone();
    assert!(undelegate_game(&mut s, &creator));
    for a in accounts {
        assert_eq!(owner(&s.svm, Base, a), rival_river::id());
    }
    assert_eq!(accounts.map(|a| readers(&s.svm, a)), before);
}

#[test]
fn undelegate_before_permissions_exist_still_works() {
    let mut s = delegated(); // no init_permissions
    let creator = s.creator.insecure_clone();
    force_finish(&mut s);
    assert!(undelegate_game(&mut s, &creator));
    assert_eq!(owner(&s.svm, Base, s.game), rival_river::id());
}

#[test]
fn delegation_never_commits_on_a_timer() {
    use ephemeral_rollups_sdk::pda::delegation_record_pda_from_delegated_account;
    let s = delegated();
    for a in [s.game, s.deck, s.hand_creator, s.hand_opponent] {
        let record = s.svm.get_account_for(Base, &addr(delegation_record_pda_from_delegated_account(&a))).unwrap();
        // commit_frequency_ms: after discriminator, 2 pubkeys and 2 u64s.
        let freq = u64::from_le_bytes(record.data[8 + 32 + 32 + 8 + 8..][..8].try_into().unwrap());
        assert_eq!(freq, u32::MAX as u64, "{a} would be committed periodically");
    }
}

// ---- Turn timer (rollup) and refund deadline (Solana) ----------------------------

use rival_river::constants::{MATCH_SECONDS, SETTLE_GRACE_SECONDS, TURN_SECONDS};

/// Seconds after init_game until a match in play can be refunded.
const REFUNDABLE: i64 = MATCH_SECONDS + SETTLE_GRACE_SECONDS + 1;

fn advance_clock(s: &mut Setup, seconds: i64) {
    let mut clock = s.svm.get_sysvar::<Clock>();
    clock.unix_timestamp += seconds;
    s.svm.set_sysvar(&clock);
}

fn now(s: &Setup) -> i64 {
    s.svm.get_sysvar::<Clock>().unix_timestamp
}

fn claim_timeout_ix(s: &Setup, signer: &Keypair) -> Instruction {
    ix(
        instruction::ClaimTimeout {},
        accounts::ClaimTimeout {
            player: key(signer),
            game: s.game,
            deck: s.deck,
            hand_creator: s.hand_creator,
            hand_opponent: s.hand_opponent,
        },
    )
}

/// None if it succeeded, else the program's error name.
fn claim_timeout(s: &mut Setup, signer: &Keypair) -> Option<String> {
    let ix = claim_timeout_ix(s, signer);
    error_name(&mut s.svm, Ephemeral, signer, &[ix])
}

#[test]
fn timeout_needs_the_deadline_to_pass() {
    let mut s = preflop();
    let opponent = s.opponent.insecure_clone();
    assert_eq!(claim_timeout(&mut s, &opponent).as_deref(), Some("NotTimedOut"));
    advance_clock(&mut s, TURN_SECONDS);
    assert_eq!(claim_timeout(&mut s, &opponent).as_deref(), Some("NotTimedOut"), "deadline itself is still in time");
}

#[test]
fn timed_out_player_facing_a_bet_folds() {
    let mut s = preflop();
    let opponent = s.opponent.insecure_clone();
    advance_clock(&mut s, TURN_SECONDS + 1);
    assert_eq!(claim_timeout(&mut s, &opponent), None);
    let g = read_game(&s.svm, Ephemeral, s.game);
    assert_eq!((g.phase, g.stacks), (Phase::Waiting, [95, 105]));
}

#[test]
fn timed_out_player_who_can_check_checks() {
    let mut s = preflop();
    let creator = s.creator.insecure_clone();
    assert!(act(&mut s, &creator, Action::Call));
    advance_clock(&mut s, TURN_SECONDS + 1);
    assert_eq!(claim_timeout(&mut s, &creator), None);
    let g = read_game(&s.svm, Ephemeral, s.game);
    assert_eq!((g.phase, g.pot, g.to_act), (Phase::Flop, 20, 1));
    assert_eq!(g.deadline, now(&s) + TURN_SECONDS, "the flop gets a fresh clock");
}

#[test]
fn each_action_restarts_the_clock() {
    let mut s = preflop();
    let creator = s.creator.insecure_clone();
    advance_clock(&mut s, TURN_SECONDS - 5);
    assert!(act(&mut s, &creator, Action::Call)); // just in time
    advance_clock(&mut s, TURN_SECONDS - 5);
    assert_eq!(claim_timeout(&mut s, &creator).as_deref(), Some("NotTimedOut"));
    advance_clock(&mut s, 10);
    assert_eq!(claim_timeout(&mut s, &creator), None);
}

#[test]
fn missing_secret_forfeits_the_hand() {
    let mut s = private(); // hand 1 Dealing: creator posted 5, opponent 10
    let creator = s.creator.insecure_clone();
    assert!(submit_secret(&mut s, &creator, [1; 32]));
    advance_clock(&mut s, TURN_SECONDS + 1);
    assert_eq!(claim_timeout(&mut s, &creator), None);
    let g = read_game(&s.svm, Ephemeral, s.game);
    assert_eq!((g.phase, g.stacks), (Phase::Waiting, [110, 90]), "opponent forfeits their blind");
}

#[test]
fn nobody_can_claim_while_both_stall() {
    let mut s = private();
    let creator = s.creator.insecure_clone();
    advance_clock(&mut s, TURN_SECONDS + 1);
    assert_eq!(claim_timeout(&mut s, &creator).as_deref(), Some("SecretsMissing"));
}

#[test]
fn stuck_shuffle_can_be_requested_again() {
    let mut s = private();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    both_secrets(&mut s);
    assert!(request_shuffle(&mut s, &creator));
    assert_eq!(claim_timeout(&mut s, &opponent).as_deref(), Some("NotTimedOut"));
    advance_clock(&mut s, TURN_SECONDS + 1); // the oracle hasn't answered (no slot passed)
    assert_eq!(claim_timeout(&mut s, &opponent), None);
    assert!(!read_deck(&s.svm, Ephemeral, s.deck).pending);
    assert!(request_shuffle(&mut s, &opponent));

    // Both answers arrive: the first deals, the second is refused.
    let slot = s.svm.get_sysvar::<Clock>().slot;
    let results = s.svm.warp_to_slot(slot + 1);
    assert_eq!(results.iter().map(|r| r.is_ok()).collect::<Vec<_>>(), vec![true, false]);
    assert_eq!(read_game(&s.svm, Ephemeral, s.game).phase, Phase::Preflop);
}

#[test]
fn waiting_and_finished_have_no_timeout() {
    let mut s = delegated(); // Waiting
    let creator = s.creator.insecure_clone();
    advance_clock(&mut s, TURN_SECONDS + 1);
    assert_eq!(claim_timeout(&mut s, &creator).as_deref(), Some("NotTimedOut"));
    let mut s = finished();
    let creator = s.creator.insecure_clone();
    advance_clock(&mut s, TURN_SECONDS + 1);
    assert_eq!(claim_timeout(&mut s, &creator).as_deref(), Some("NotTimedOut"));
}

fn refund(s: &mut Setup) -> Option<String> {
    let payer = Keypair::new();
    s.svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let ix = ix(
        instruction::Refund {},
        accounts::Refund {
            table: s.table,
            game: s.game,
            deck: s.deck,
            hand_creator: s.hand_creator,
            hand_opponent: s.hand_opponent,
            mint: s.mint,
            creator_token: ata(key(&s.creator), s.mint),
            opponent_token: ata(key(&s.opponent), s.mint),
            vault: ata(s.table, s.mint),
            creator: key(&s.creator),
            token_program: token_program(),
        },
    );
    error_name(&mut s.svm, Base, &payer, &[ix])
}

#[test]
fn stakes_come_back_if_the_rollup_never_returns_the_game() {
    let mut s = preflop(); // mid-hand, still delegated
    assert_eq!(refund(&mut s).as_deref(), Some("RefundTooEarly"));
    advance_clock(&mut s, REFUNDABLE);
    assert_eq!(refund(&mut s), None);
    let tokens = [key(&s.creator), key(&s.opponent)].map(|p| ata(p, s.mint));
    assert_eq!(tokens.map(|t| balance(&s.svm, t)), [Some(STAKE), Some(STAKE)]);
    assert_eq!(balance(&s.svm, ata(s.table, s.mint)), None, "vault closed");
    assert_eq!(read_table(&s.svm, s.table).status, TableStatus::Refunded);
    assert!(refund(&mut s).is_some(), "only once");
}

#[test]
fn finished_match_is_settled_not_refunded() {
    let mut s = finished();
    let creator = s.creator.insecure_clone();
    assert!(undelegate_game(&mut s, &creator));
    advance_clock(&mut s, REFUNDABLE);
    // The loser can't wait out the deadline to get their stake back.
    assert_eq!(refund(&mut s).as_deref(), Some("MatchFinished"));
    let winner = read_game(&s.svm, Base, s.game).winner.unwrap() as usize;
    let winner_token = ata([key(&s.creator), key(&s.opponent)][winner], s.mint);
    assert!(settle(&mut s, winner_token));
    assert!(refund(&mut s).is_some(), "settled tables can't be refunded");
}

// ---- Edge cases: short stacks, end of match, closing up ---------------------------

/// (lamports, data) of Game, Deck and both Hands on Solana. settle and the
/// refunds must leave them there: closing them would publish the match's
/// transaction history on the real rollup.
fn match_accounts(s: &Setup) -> [(u64, Vec<u8>); 4] {
    [s.game, s.deck, s.hand_creator, s.hand_opponent].map(|a| {
        let acc = s.svm.get_account_for(Base, &addr(a)).expect("match account closed");
        assert!(acc.lamports > 0, "{a} closed");
        (acc.lamports, acc.data)
    })
}

fn closed(s: &Setup, account: Pubkey) -> bool {
    s.svm.get_account_for(Base, &addr(account)).map_or(true, |a| a.lamports == 0)
}

fn set_stacks(s: &mut Setup, stacks: [u16; 2]) {
    let game = s.game;
    edit_ephemeral::<Game>(s, game, |g| g.stacks = stacks);
}

/// None if it succeeded, else the program's error name.
fn act_err(s: &mut Setup, signer: &Keypair, action: Action) -> Option<String> {
    let i = ix(
        instruction::Act { action },
        accounts::Act { player: key(signer), game: s.game, deck: s.deck, hand_creator: s.hand_creator, hand_opponent: s.hand_opponent },
    );
    error_name(&mut s.svm, Ephemeral, signer, &[i])
}

/// The stacks the showdown should leave: [creator wins, opponent wins, split].
fn expect_showdown(s: &Setup, outcomes: [[u16; 2]; 3]) {
    let [c, o] = scores(s);
    let expected = match c.cmp(&o) {
        std::cmp::Ordering::Greater => outcomes[0],
        std::cmp::Ordering::Less => outcomes[1],
        std::cmp::Ordering::Equal => outcomes[2],
    };
    let g = read_game(&s.svm, Ephemeral, s.game);
    assert_eq!(g.stacks, expected);
    assert_eq!(total_chips(&g), 200);
    assert_eq!(g.phase == Phase::Finished, g.stacks.contains(&0));
}

#[test]
fn short_all_in_call_gets_the_unmatched_chips_back() {
    let mut s = preflop(); // bets [5, 10]
    set_stacks(&mut s, [170, 15]);
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(act(&mut s, &creator, Action::Raise { to: 175 }));
    assert!(act(&mut s, &opponent, Action::Call)); // can only add 15
    // 25 each is matched (pot 50); the creator's other 150 comes back.
    expect_showdown(&s, [[200, 0], [150, 50], [175, 25]]);
}

/// delegated() + permissions, with `stacks` set before hand 1's blinds.
fn hand_one_with(stacks: [u16; 2]) -> Setup {
    let mut s = delegated();
    let creator = s.creator.insecure_clone();
    assert!(init_permissions(&mut s, &creator));
    set_stacks(&mut s, stacks);
    assert!(start_hand(&mut s, &creator));
    s
}

#[test]
fn small_blind_that_cannot_cover_is_all_in() {
    let mut s = hand_one_with([3, 197]); // creator is the small blind
    let g = read_game(&s.svm, Ephemeral, s.game);
    assert_eq!((g.bets, g.stacks, g.to_act), ([3, 10], [0, 187], 1), "big blind acts first");
    shuffle_and_deal(&mut s);
    let opponent = s.opponent.insecure_clone();
    assert!(act(&mut s, &opponent, Action::Check));
    // 3 each matched (pot 6), 7 back to the big blind, board run out.
    expect_showdown(&s, [[6, 194], [0, 200], [3, 197]]);
}

#[test]
fn big_blind_that_cannot_cover_is_all_in() {
    let mut s = hand_one_with([196, 4]); // opponent is the big blind
    shuffle_and_deal(&mut s);
    let creator = s.creator.insecure_clone();
    assert_eq!(read_game(&s.svm, Ephemeral, s.game).bets, [5, 4]);
    assert_eq!(act_err(&mut s, &creator, Action::Raise { to: 20 }).as_deref(), Some("OpponentAllIn"));
    assert!(act(&mut s, &creator, Action::Check));
    expect_showdown(&s, [[200, 0], [192, 8], [196, 4]]);
}

#[test]
fn chip_leader_wins_after_hand_six() {
    let mut s = delegated();
    let creator = s.creator.insecure_clone();
    assert!(init_permissions(&mut s, &creator));
    let game = s.game;
    edit_ephemeral::<Game>(&mut s, game, |g| { g.hand_number = 5; g.stacks = [120, 80]; });
    assert!(start_hand(&mut s, &creator)); // hand 6: opponent's button, 50/100
    shuffle_and_deal(&mut s);
    let g = read_game(&s.svm, Ephemeral, s.game);
    assert_eq!((g.hand_number, g.dealer, g.bets), (6, 1, [100, 50]));
    let opponent = s.opponent.insecure_clone();
    assert!(act(&mut s, &opponent, Action::Fold));
    let g = read_game(&s.svm, Ephemeral, s.game);
    assert_eq!((g.phase, g.winner, g.stacks), (Phase::Finished, Some(0), [170, 30]));
}

#[test]
fn level_stacks_after_hand_six_play_sudden_death() {
    let mut s = delegated();
    let creator = s.creator.insecure_clone();
    assert!(init_permissions(&mut s, &creator));
    let game = s.game;
    edit_ephemeral::<Game>(&mut s, game, |g| g.hand_number = 6);
    assert!(start_hand(&mut s, &creator));
    let g = read_game(&s.svm, Ephemeral, s.game);
    assert_eq!((g.hand_number, g.bets, g.phase), (7, [50, 100], Phase::Dealing), "last blind level");
}

#[test]
fn match_cannot_run_past_255_hands() {
    let mut s = delegated();
    let creator = s.creator.insecure_clone();
    let game = s.game;
    edit_ephemeral::<Game>(&mut s, game, |g| g.hand_number = u8::MAX);
    let i = ix(instruction::StartHand {}, accounts::StartHand { player: key(&creator), game });
    assert_eq!(error_name(&mut s.svm, Ephemeral, &creator, &[i]).as_deref(), Some("MatchTooLong"));
}

#[test]
fn minimum_bet_resets_each_street() {
    let mut s = preflop();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(act(&mut s, &creator, Action::Raise { to: 40 })); // raise by 30
    assert!(act(&mut s, &opponent, Action::Call));
    assert_eq!(read_game(&s.svm, Ephemeral, s.game).min_raise, 10, "back to the big blind");
    assert_eq!(act_err(&mut s, &opponent, Action::Raise { to: 5 }).as_deref(), Some("RaiseTooSmall"));
    assert!(act(&mut s, &opponent, Action::Raise { to: 10 }));
    assert_eq!(act_err(&mut s, &creator, Action::Check).as_deref(), Some("CannotCheck"));
}

#[test]
fn call_needs_something_to_call_and_act_needs_a_betting_round() {
    let mut s = private(); // Dealing
    let creator = s.creator.insecure_clone();
    assert_eq!(act_err(&mut s, &creator, Action::Call).as_deref(), Some("NotBetting"));
    shuffle_and_deal(&mut s);
    assert!(act(&mut s, &creator, Action::Call)); // limp
    let opponent = s.opponent.insecure_clone();
    assert_eq!(act_err(&mut s, &opponent, Action::Call).as_deref(), Some("NothingToCall"));
}

#[test]
fn refund_of_a_never_delegated_game_closes_the_table() {
    let mut s = setup();
    init_game(&mut s); // on Solana, Waiting: nobody delegated it
    let creator = s.creator.insecure_clone();
    advance_clock(&mut s, REFUNDABLE);
    let kept = match_accounts(&s);
    let rent: u64 = [s.table, ata(s.table, s.mint)].iter().map(|a| s.svm.get_balance(&addr(*a)).unwrap()).sum();
    let before = s.svm.get_balance(&creator.pubkey()).unwrap();
    assert_eq!(refund(&mut s), None);
    let tokens = [key(&s.creator), key(&s.opponent)].map(|p| ata(p, s.mint));
    assert_eq!(tokens.map(|t| balance(&s.svm, t)), [Some(STAKE), Some(STAKE)]);
    assert!(closed(&s, s.table), "table not closed");
    assert_eq!(match_accounts(&s), kept);
    assert_eq!(s.svm.get_balance(&creator.pubkey()).unwrap(), before + rent);
}

#[test]
fn refund_while_delegated_keeps_the_table() {
    let mut s = preflop();
    advance_clock(&mut s, REFUNDABLE);
    assert_eq!(refund(&mut s), None);
    // The game still lives on the rollup, so its Table address stays taken.
    assert_eq!(read_table(&s.svm, s.table).status, TableStatus::Refunded);
}

// ---- No leaving mid-match ---------------------------------------------------

/// A player who is behind must not be able to undelegate between hands: the
/// leader would have to re-delegate every time, and once the refund deadline
/// passes an unfinished game splits the stakes 50/50 whatever the chips say.
#[test]
fn trailing_player_cannot_undelegate_to_run_out_the_clock() {
    let mut s = preflop(); // hand 1, creator is the button and acts first
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(act(&mut s, &creator, Action::Raise { to: 30 }));
    assert!(act(&mut s, &opponent, Action::Fold));
    let g = read_game(&s.svm, Ephemeral, s.game);
    assert_eq!((g.phase, g.stacks), (Phase::Waiting, [110, 90]));

    // Between hands (Waiting) and before cards (Dealing): both refused.
    let undelegate = |s: &mut Setup, k: &Keypair| {
        let ix = undelegate_game_ix(s, k);
        error_name(&mut s.svm, Ephemeral, k, &[ix])
    };
    assert_eq!(undelegate(&mut s, &opponent).as_deref(), Some("MatchNotFinished"));
    assert!(start_hand(&mut s, &creator));
    assert_eq!(undelegate(&mut s, &opponent).as_deref(), Some("MatchNotFinished"));
    assert_eq!(owner(&s.svm, Base, s.game), Pubkey::new_from_array(DELEGATION_PROGRAM_ID.to_bytes()));
}

// ---- Match clock, shuffle deadline, closing refunded tables ----------------------

use rival_river::constants::START_SECONDS;

fn init_game_err(s: &mut Setup) -> Option<String> {
    let creator = s.creator.insecure_clone();
    let ix = ix(
        instruction::InitGame {},
        accounts::InitGame {
            payer: key(&creator),
            table: s.table,
            game: s.game,
            deck: s.deck,
            hand_creator: s.hand_creator,
            hand_opponent: s.hand_opponent,
            system_program: system_program::ID,
        },
    );
    error_name(&mut s.svm, Base, &creator, &[ix])
}

fn close_refunded(s: &mut Setup) -> Option<String> {
    let payer = Keypair::new();
    s.svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let ix = ix(
        instruction::CloseRefunded {},
        accounts::CloseRefunded {
            table: s.table,
            game: s.game,
            deck: s.deck,
            hand_creator: s.hand_creator,
            hand_opponent: s.hand_opponent,
            creator: key(&s.creator),
        },
    );
    error_name(&mut s.svm, Base, &payer, &[ix])
}

#[test]
fn late_start_is_refused_and_refundable() {
    let mut s = setup(); // joined, init_game not run
    advance_clock(&mut s, START_SECONDS + 1);
    assert_eq!(init_game_err(&mut s).as_deref(), Some("MatchExpired"));
    assert_eq!(refund(&mut s), None);
    let tokens = [key(&s.creator), key(&s.opponent)].map(|p| ata(p, s.mint));
    assert_eq!(tokens.map(|t| balance(&s.svm, t)), [Some(STAKE), Some(STAKE)]);
}

/// The creator can't start late to squeeze the match against the deadline.
#[test]
fn match_clock_starts_at_init_game() {
    let mut s = setup();
    advance_clock(&mut s, START_SECONDS - 1); // the creator waits to the last moment
    let start = now(&s);
    init_game(&mut s);
    assert_eq!(read_table(&s.svm, s.table).deadline, start + MATCH_SECONDS);
    let creator = s.creator.insecure_clone();
    assert!(delegate_game(&mut s, &creator));
    assert_eq!(read_game(&s.svm, Ephemeral, s.game).match_deadline, start + MATCH_SECONDS);
    // Over 2h since join_table, but not since the game started.
    advance_clock(&mut s, MATCH_SECONDS - 1);
    assert_eq!(refund(&mut s).as_deref(), Some("RefundTooEarly"));
}

#[test]
fn request_shuffle_gives_the_oracle_a_full_turn() {
    let mut s = private();
    let creator = s.creator.insecure_clone();
    both_secrets(&mut s);
    advance_clock(&mut s, TURN_SECONDS - 1); // request at the last second
    assert!(request_shuffle(&mut s, &creator));
    advance_clock(&mut s, 2);
    assert_eq!(claim_timeout(&mut s, &creator).as_deref(), Some("NotTimedOut"));
    advance_clock(&mut s, TURN_SECONDS);
    assert_eq!(claim_timeout(&mut s, &creator), None, "now the stuck request can be cleared");
    assert!(!read_deck(&s.svm, Ephemeral, s.deck).pending);
}

#[test]
fn no_delegating_after_the_deadline() {
    let mut s = setup();
    init_game(&mut s);
    advance_clock(&mut s, MATCH_SECONDS + 1);
    let creator = s.creator.insecure_clone();
    let ixs = delegate_game_ixs(&s, &creator);
    assert_eq!(error_name(&mut s.svm, Base, &creator, &ixs).as_deref(), Some("MatchExpired"));
}

/// refund keeps the Table while the game is delegated; once it's back,
/// close_refunded returns the Table's rent to the creator.
#[test]
fn close_refunded_recovers_a_game_left_on_the_rollup() {
    let mut s = preflop(); // mid-hand, delegated, cards live
    let opponent = s.opponent.insecure_clone();
    assert!(!undelegate_game(&mut s, &opponent), "not before the deadline");
    advance_clock(&mut s, REFUNDABLE);
    assert_eq!(refund(&mut s), None);
    assert_eq!(read_table(&s.svm, s.table).status, TableStatus::Refunded);
    assert!(close_refunded(&mut s).is_some(), "game still delegated");

    // Past the deadline anyone at the table can bring it back, unfinished.
    assert!(undelegate_game(&mut s, &opponent));
    assert_nothing_secret_on_solana(&s);

    let kept = match_accounts(&s);
    let rent = s.svm.get_balance(&addr(s.table)).unwrap();
    let before = s.svm.get_balance(&addr(key(&s.creator))).unwrap();
    assert_eq!(close_refunded(&mut s), None);
    assert!(closed(&s, s.table), "table not closed");
    assert_eq!(match_accounts(&s), kept);
    assert_eq!(s.svm.get_balance(&addr(key(&s.creator))).unwrap(), before + rent);
    assert!(close_refunded(&mut s).is_some(), "only once");
}

#[test]
fn close_refunded_needs_a_refunded_table() {
    let mut s = setup();
    init_game(&mut s); // InPlay, game on Solana
    assert_eq!(close_refunded(&mut s).as_deref(), Some("NotRefunded"));
}

// ---- Session keys ------------------------------------------------------------

fn set_session_key(s: &mut Setup, signer: &Keypair, session: Pubkey) -> Option<String> {
    let ix = ix(
        instruction::SetSessionKey { key: session },
        accounts::SetSessionKey { player: key(signer), game: s.game },
    );
    error_name(&mut s.svm, Ephemeral, signer, &[ix])
}

/// private() + a fresh, unfunded session key for each player, registered by
/// their wallet. Returns [creator's, opponent's].
fn with_sessions() -> (Setup, [Keypair; 2]) {
    let mut s = private();
    let sessions = [Keypair::new(), Keypair::new()];
    let wallets = [s.creator.insecure_clone(), s.opponent.insecure_clone()];
    for (wallet, session) in wallets.iter().zip(&sessions) {
        assert_eq!(set_session_key(&mut s, wallet, key(session)), None);
    }
    (s, sessions)
}

#[test]
fn session_keys_play_a_whole_hand() {
    let (mut s, [c, o]) = with_sessions();
    let (hc, ho) = (s.hand_creator, s.hand_opponent);
    let g = read_game(&s.svm, Ephemeral, s.game);
    assert_eq!(g.session_keys, [key(&c), key(&o)]);

    assert!(submit_secret_to(&mut s, &c, hc, [0xC1; 32]));
    assert!(submit_secret_to(&mut s, &o, ho, [0x0B; 32]));
    assert!(request_shuffle(&mut s, &c), "unfunded session key can request the VRF");
    assert_eq!(fulfill(&mut s.svm), 1);
    assert!(act(&mut s, &c, Action::Call));
    assert!(act(&mut s, &o, Action::Raise { to: 30 }));
    assert!(act(&mut s, &c, Action::Fold)); // creator put in 10
    assert_eq!(read_game(&s.svm, Ephemeral, s.game).stacks, [90, 110]);

    // Next hand, and a timeout claim, from session keys too.
    assert!(start_hand(&mut s, &o));
    advance_clock(&mut s, TURN_SECONDS + 1);
    assert!(submit_secret_to(&mut s, &c, hc, [0xC2; 32]));
    assert_eq!(claim_timeout(&mut s, &c), None, "opponent never sent a secret");
    assert_eq!(read_game(&s.svm, Ephemeral, s.game).phase, Phase::Waiting);
}

#[test]
fn session_key_plays_only_its_own_seat() {
    let (mut s, [c, o]) = with_sessions();
    let (hc, ho) = (s.hand_creator, s.hand_opponent);
    assert!(!submit_secret_to(&mut s, &o, hc, [1; 32]), "opponent's key can't write the creator's Hand");
    assert!(!submit_secret_to(&mut s, &c, ho, [1; 32]));
    both_secrets(&mut s);
    let creator = s.creator.insecure_clone();
    assert!(request_shuffle(&mut s, &creator));
    fulfill(&mut s.svm);
    assert!(!act(&mut s, &o, Action::Call), "creator (button) acts first");
    assert!(act(&mut s, &c, Action::Call));
}

#[test]
fn only_a_wallet_can_set_a_session_key() {
    let (mut s, [c, _]) = with_sessions();
    let stranger = Keypair::new();
    s.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    assert_eq!(set_session_key(&mut s, &c, key(&stranger)).as_deref(), Some("NotAPlayer"));
    assert_eq!(set_session_key(&mut s, &stranger, key(&stranger)).as_deref(), Some("NotAPlayer"));
}

#[test]
fn session_key_cannot_be_the_other_players_key() {
    let (mut s, [c, _]) = with_sessions();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert_eq!(set_session_key(&mut s, &opponent, key(&c)).as_deref(), Some("SessionKeyTaken"));
    assert_eq!(set_session_key(&mut s, &opponent, key(&creator)).as_deref(), Some("SessionKeyTaken"));
    assert_eq!(set_session_key(&mut s, &creator, key(&c)), None, "re-setting your own is a no-op");
}

#[test]
fn replacing_a_session_key_retires_the_old_one() {
    let (mut s, [old, o]) = with_sessions();
    let creator = s.creator.insecure_clone();
    let hc = s.hand_creator;
    let new = Keypair::new();
    assert_eq!(set_session_key(&mut s, &creator, key(&new)), None);
    assert!(!submit_secret_to(&mut s, &old, hc, [1; 32]), "lost tab's key no longer plays");
    assert!(submit_secret_to(&mut s, &new, hc, [1; 32]));

    // Removing it leaves only the wallet.
    assert_eq!(set_session_key(&mut s, &creator, Pubkey::default()), None);
    let ho = s.hand_opponent;
    assert!(submit_secret_to(&mut s, &o, ho, [2; 32]));
    assert!(!request_shuffle(&mut s, &new));
    assert!(request_shuffle(&mut s, &creator));
}

// ---- Match deadline: play stops, then a grace window to settle --------------

fn start_hand_err(s: &mut Setup, signer: &Keypair) -> Option<String> {
    let ix = ix(instruction::StartHand {}, accounts::StartHand { player: key(signer), game: s.game });
    error_name(&mut s.svm, Ephemeral, signer, &[ix])
}

#[test]
fn play_stops_at_the_match_deadline() {
    let mut s = preflop();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    advance_clock(&mut s, MATCH_SECONDS + 1);
    assert_eq!(act_err(&mut s, &creator, Action::Call).as_deref(), Some("MatchExpired"));
    assert_eq!(claim_timeout(&mut s, &opponent).as_deref(), Some("MatchExpired"), "a timeout forfeit is play too");

    let mut s = preflop(); // a fresh table, with new players
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(act(&mut s, &creator, Action::Fold)); // hand 1 over: Waiting
    advance_clock(&mut s, MATCH_SECONDS + 1);
    assert_eq!(start_hand_err(&mut s, &opponent).as_deref(), Some("MatchExpired"));
}

#[test]
fn dealing_forfeit_stops_at_the_match_deadline() {
    let mut s = private(); // Dealing, nobody has sent a secret
    let creator = s.creator.insecure_clone();
    assert!(submit_secret(&mut s, &creator, [1; 32]));
    advance_clock(&mut s, MATCH_SECONDS + 1);
    assert_eq!(claim_timeout(&mut s, &creator).as_deref(), Some("MatchExpired"));
}

/// The race this window closes: the match ends just before the deadline, and
/// the loser tries to refund (a 50/50 split) while the winner's undelegate is
/// still landing.
#[test]
fn match_finished_at_the_deadline_still_settles() {
    let mut s = finished(); // Finished, still on the rollup
    let creator = s.creator.insecure_clone();
    advance_clock(&mut s, MATCH_SECONDS + 1);
    assert_eq!(refund(&mut s).as_deref(), Some("RefundTooEarly"));
    assert!(undelegate_game(&mut s, &creator));
    let winner = read_game(&s.svm, Base, s.game).winner.unwrap() as usize;
    let winner_token = ata([key(&s.creator), key(&s.opponent)][winner], s.mint);
    assert!(settle(&mut s, winner_token));
    assert_eq!(balance(&s.svm, winner_token), Some(2 * STAKE));
}

#[test]
fn unfinished_match_refunds_only_after_the_grace() {
    let mut s = preflop();
    advance_clock(&mut s, MATCH_SECONDS + SETTLE_GRACE_SECONDS);
    assert_eq!(refund(&mut s).as_deref(), Some("RefundTooEarly"));
    advance_clock(&mut s, 1);
    assert_eq!(refund(&mut s), None);
}

// ---- Session keys named at stake time -------------------------------------------

/// What the app does: both name a session key when they stake, the opponent
/// opens and delegates the game. Returns [creator's, opponent's] session keys.
fn staked_sessions() -> (Setup, [Keypair; 2]) {
    let sessions = [Keypair::new(), Keypair::new()];
    let mut s = setup_with([key(&sessions[0]), key(&sessions[1])]);
    let opponent = s.opponent.insecure_clone();
    init_game_by(&mut s, &opponent);
    assert!(delegate_game(&mut s, &opponent));
    (s, sessions)
}

#[test]
fn stake_time_session_keys_are_in_the_game() {
    let (s, [c, o]) = staked_sessions();
    assert_eq!(read_game(&s.svm, Ephemeral, s.game).session_keys, [key(&c), key(&o)]);
}

#[test]
fn session_key_makes_the_table_private_and_can_read_its_own_hand() {
    let (mut s, [c, o]) = staked_sessions();
    assert!(init_permissions(&mut s, &c), "an unfunded session key can send init_permissions");
    let (cw, ow) = (key(&s.creator), key(&s.opponent));
    let (cs, os) = (key(&c), key(&o));
    assert_eq!(readers(&s.svm, s.game), (true, vec![cw, cs, ow, os], false));
    assert_eq!(readers(&s.svm, s.deck), (true, vec![], false));
    assert_eq!(readers(&s.svm, s.hand_creator), (true, vec![cw, cs], false));
    assert_eq!(readers(&s.svm, s.hand_opponent), (true, vec![ow, os], false));

    // Signed in as the session key, the tab reads Game and only its own Hand.
    let (game, deck, hand_c, hand_o) = (s.game, s.deck, s.hand_creator, s.hand_opponent);
    let mut can_read = |viewer: Pubkey, account: Pubkey| {
        s.svm.set_authorized_user(Some(addr(viewer)));
        s.svm.get_account_for(Ephemeral, &addr(account)).is_some()
    };
    assert!(can_read(cs, game) && can_read(cs, hand_c));
    assert!(!can_read(cs, hand_o) && !can_read(cs, deck));
    assert!(can_read(os, hand_o) && !can_read(os, hand_c));
}

#[test]
fn session_key_brings_the_finished_game_back() {
    let (mut s, [c, o]) = staked_sessions();
    assert!(init_permissions(&mut s, &c));
    assert!(check_in(&mut s, &c) && check_in(&mut s, &o));
    assert!(start_hand(&mut s, &c));
    let early = undelegate_game_ix(&s, &c);
    assert_eq!(error_name(&mut s.svm, Ephemeral, &c, &[early]).as_deref(), Some("MatchNotFinished"));
    force_finish(&mut s);
    assert!(undelegate_game(&mut s, &c));
    assert_eq!(owner(&s.svm, Base, s.game), rival_river::id());
}

#[test]
fn stranger_session_cannot_make_permissions_or_undelegate() {
    let (mut s, _) = staked_sessions();
    let stranger = Keypair::new();
    assert!(!init_permissions(&mut s, &stranger));
    force_finish(&mut s);
    assert!(!undelegate_game(&mut s, &stranger));
}

// ---- Open tables (invite link) -----------------------------------------------

#[test]
fn an_open_table_joined_by_link_plays_on_the_rollup() {
    let sessions = [Keypair::new(), Keypair::new()];
    let mut s = setup_full([key(&sessions[0]), key(&sessions[1])], true);
    let opponent = s.opponent.insecure_clone();
    // As the app does: the joiner opens and delegates the game.
    init_game_by(&mut s, &opponent);
    assert!(delegate_game(&mut s, &opponent));
    assert!(init_permissions(&mut s, &sessions[0]));
    // The joiner's Hand is theirs alone.
    assert_eq!(readers(&s.svm, s.hand_opponent), (true, vec![key(&opponent), key(&sessions[1])], false));

    assert!(check_in(&mut s, &sessions[0]) && check_in(&mut s, &sessions[1]));
    assert!(start_hand(&mut s, &sessions[0]));
    shuffle_and_deal(&mut s);
    assert!(read_hand(&s.svm, Ephemeral, s.hand_opponent).dealt, "the joiner was dealt in");
}

// ---- Check-in before the first hand ------------------------------------------

#[test]
fn no_hand_starts_until_both_players_check_in() {
    let mut s = delegated_empty();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    let stranger = Keypair::new();
    assert!(!check_in(&mut s, &stranger));

    // The joiner alone, twice: the creator's seat stays empty.
    assert!(check_in(&mut s, &opponent));
    assert!(check_in(&mut s, &opponent), "safe to send again");
    assert_eq!(read_game(&s.svm, Ephemeral, s.game).checked_in, [false, true]);
    assert_eq!(start_hand_err(&mut s, &opponent).as_deref(), Some("NotCheckedIn"));
    advance_clock(&mut s, TURN_SECONDS + 1);
    assert_eq!(claim_timeout(&mut s, &opponent).as_deref(), Some("NotTimedOut"), "nothing to forfeit");

    assert!(check_in(&mut s, &creator));
    assert!(start_hand(&mut s, &opponent));
}

#[test]
fn a_player_who_never_checks_in_loses_nothing() {
    let mut s = delegated_empty();
    let opponent = s.opponent.insecure_clone();
    assert!(check_in(&mut s, &opponent));
    advance_clock(&mut s, REFUNDABLE);
    assert_eq!(refund(&mut s), None);
    let tokens = [key(&s.creator), key(&s.opponent)].map(|p| ata(p, s.mint));
    assert_eq!(tokens.map(|t| balance(&s.svm, t)), [Some(STAKE), Some(STAKE)]);
}

// ---- Reusing a table id -------------------------------------------------------

/// The match accounts outlive their Table, so a creator who reuses its id gets
/// a table whose game can't be created. Stakes put into it must still come back.
#[test]
fn a_reused_table_id_cannot_trap_stakes() {
    let mut s = finished();
    let (creator, opponent) = (s.creator.insecure_clone(), s.opponent.insecure_clone());
    assert!(undelegate_game(&mut s, &creator));
    let winner = read_game(&s.svm, Base, s.game).winner.unwrap() as usize;
    let mint = s.mint;
    assert!(settle(&mut s, ata([key(&creator), key(&opponent)][winner], mint)));

    for k in [&creator, &opponent] {
        fund(&mut s.svm, key(k), mint, STAKE);
    }
    let vault = ata(s.table, s.mint);
    assert!(send(&mut s.svm, Base, &creator, ix(
        instruction::CreateTable {
            table_id: 1,
            opponent: key(&opponent),
            stake: STAKE,
            session_key: Pubkey::default(),
            invite_key: Pubkey::default(),
        },
        accounts::CreateTable {
            creator: key(&creator),
            table: s.table,
            mint: s.mint,
            creator_token: ata(key(&creator), s.mint),
            vault,
            token_program: token_program(),
            associated_token_program: Pubkey::new_from_array(ASSOCIATED_TOKEN_PROGRAM_ID.to_bytes()),
            system_program: system_program::ID,
        },
    )));
    assert!(send(&mut s.svm, Base, &opponent, ix(
        instruction::JoinTable { session_key: Pubkey::default(), stake: STAKE },
        accounts::JoinTable {
            opponent: key(&opponent),
            invite: None,
            table: s.table,
            mint: s.mint,
            opponent_token: ata(key(&opponent), s.mint),
            vault,
            token_program: token_program(),
        },
    )));
    assert!(init_game_err(&mut s).is_some(), "the old game is still there");

    advance_clock(&mut s, REFUNDABLE);
    assert_eq!(refund(&mut s), None);
    let tokens = [key(&creator), key(&opponent)].map(|p| ata(p, s.mint));
    assert_eq!(tokens.map(|t| balance(&s.svm, t)), [Some(STAKE), Some(STAKE)]);
}
