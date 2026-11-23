use {
    anchor_lang::{
        prelude::Pubkey, solana_program::instruction::Instruction, AccountDeserialize,
        InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    rival_river::state::{Table, TableStatus},
    rival_river::constants::TABLE_SEED,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

fn setup() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/rival_river.so");
    svm.add_program(rival_river::id(), bytes).unwrap();
    let creator = Keypair::new();
    svm.airdrop(&creator.pubkey(), 1_000_000_000).unwrap();
    (svm, creator)
}

fn table_pda(creator: &Pubkey, table_id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[TABLE_SEED, creator.as_ref(), &table_id.to_le_bytes()],
        &rival_river::id(),
    )
    .0
}

fn create_table(
    svm: &mut LiteSVM,
    creator: &Keypair,
    table_id: u64,
    opponent: Pubkey,
    creator_nft: Pubkey,
) -> bool {
    let ix = Instruction::new_with_bytes(
        rival_river::id(),
        &rival_river::instruction::CreateTable { table_id, opponent, creator_nft }.data(),
        rival_river::accounts::CreateTable {
            creator: creator.pubkey(),
            table: table_pda(&creator.pubkey(), table_id),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    );
    let msg = Message::new_with_blockhash(&[ix], Some(&creator.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[creator]).unwrap();
    let ok = svm.send_transaction(tx).is_ok();
    svm.expire_blockhash(); // so an identical retry isn't rejected as a duplicate tx
    ok
}

#[test]
fn creates_table_with_given_fields() {
    let (mut svm, creator) = setup();
    let opponent = Pubkey::new_unique();
    let nft = Pubkey::new_unique();

    assert!(create_table(&mut svm, &creator, 7, opponent, nft));

    let account = svm.get_account(&table_pda(&creator.pubkey(), 7)).unwrap();
    assert_eq!(account.owner, rival_river::id());
    let table = Table::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(table.table_id, 7);
    assert_eq!(table.creator, creator.pubkey());
    assert_eq!(table.opponent, opponent);
    assert_eq!(table.creator_nft, nft);
    assert_eq!(table.opponent_nft, None);
    assert_eq!(table.status, TableStatus::WaitingForOpponent);
}

#[test]
fn same_table_id_twice_fails() {
    let (mut svm, creator) = setup();
    let opponent = Pubkey::new_unique();
    let nft = Pubkey::new_unique();

    assert!(create_table(&mut svm, &creator, 1, opponent, nft));
    assert!(!create_table(&mut svm, &creator, 1, opponent, nft));
    // A different id is a different table.
    assert!(create_table(&mut svm, &creator, 2, opponent, nft));
}

#[test]
fn cannot_invite_yourself() {
    let (mut svm, creator) = setup();
    let me = creator.pubkey();
    assert!(!create_table(&mut svm, &creator, 1, me, Pubkey::new_unique()));
}
