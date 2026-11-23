//! Cards and hand ranking. Plain Rust: no accounts, no Anchor.

/// A card is a number 0..=51.
/// rank = card % 13  (0 = Two, 1 = Three, ... 8 = Ten, 9 = Jack, 10 = Queen, 11 = King, 12 = Ace)
/// suit = card / 13  (0..=3; which number is which suit doesn't matter in poker)
pub type Card = u8;

pub const DECK_SIZE: usize = 52;

pub fn rank(card: Card) -> u8 {
    card % 13
}

pub fn suit(card: Card) -> u8 {
    card / 13
}

// Hand categories, weakest to strongest.
pub const HIGH_CARD: u32 = 0;
pub const PAIR: u32 = 1;
pub const TWO_PAIR: u32 = 2;
pub const THREE_OF_A_KIND: u32 = 3;
pub const STRAIGHT: u32 = 4;
pub const FLUSH: u32 = 5;
pub const FULL_HOUSE: u32 = 6;
pub const FOUR_OF_A_KIND: u32 = 7;
pub const STRAIGHT_FLUSH: u32 = 8;

/// Scores a five-card hand. Higher score wins; equal scores split the pot.
///
/// Layout of the u32:  [category: 4 bits][r1][r2][r3][r4][r5]  (each r is 4 bits)
/// r1..r5 are the ranks that break ties, most important first.
/// Example: K K 7 7 2 -> TWO_PAIR, then K, 7, 2.
pub fn rank_five(cards: [Card; 5]) -> u32 {
    // 1. How many of each rank?
    let mut counts = [0u8; 13];
    for &c in &cards {
        counts[rank(c) as usize] += 1;
    }

    // 2. One (count, rank) entry per rank we hold, sorted biggest first.
    //    Tuples compare by count first, then rank, which is exactly poker's tie-break order.
    let mut groups = [(0u8, 0u8); 5];
    let mut n = 0;
    for r in 0..13u8 {
        if counts[r as usize] > 0 {
            groups[n] = (counts[r as usize], r);
            n += 1;
        }
    }
    groups[..n].sort_unstable_by(|a, b| b.cmp(a));

    // 3. Flush: all five cards share a suit.
    let is_flush = cards.iter().all(|&c| suit(c) == suit(cards[0]));

    // 4. Straight: five different ranks in a row. Ace can also be low (A-2-3-4-5).
    let mut straight_high = None;
    if n == 5 {
        let high = groups[0].1;
        let low = groups[4].1;
        if high - low == 4 {
            straight_high = Some(high);
        } else if high == 12 && groups[1].1 == 3 {
            straight_high = Some(3); // the "wheel": its top card is the Five
        }
    }

    // 5. Pick the category from what we found.
    let category = match (straight_high, is_flush, groups[0].0, groups[1].0) {
        (Some(_), true, _, _) => STRAIGHT_FLUSH,
        (_, _, 4, _) => FOUR_OF_A_KIND,
        (_, _, 3, 2) => FULL_HOUSE,
        (_, true, _, _) => FLUSH,
        (Some(_), _, _, _) => STRAIGHT,
        (_, _, 3, _) => THREE_OF_A_KIND,
        (_, _, 2, 2) => TWO_PAIR,
        (_, _, 2, _) => PAIR,
        _ => HIGH_CARD,
    };

    // 6. Pack category + tie-break ranks into one number.
    let mut score = category << 20;
    if let Some(high) = straight_high {
        score |= (high as u32) << 16; // only the top card matters for straights
    } else {
        for (i, &(_, r)) in groups[..n].iter().enumerate() {
            score |= (r as u32) << (16 - 4 * i);
        }
    }
    score
}

/// Best five-card score from seven cards (2 hole + 5 board).
/// Picking 5 of 7 = choosing 2 to leave out, so we try all 21 pairs to skip.
pub fn best_of_seven(cards: [Card; 7]) -> u32 {
    let mut best = 0;
    for skip_a in 0..7 {
        for skip_b in (skip_a + 1)..7 {
            let mut five = [0u8; 5];
            let mut n = 0;
            for (i, &c) in cards.iter().enumerate() {
                if i != skip_a && i != skip_b {
                    five[n] = c;
                    n += 1;
                }
            }
            best = best.max(rank_five(five));
        }
    }
    best
}

/// Shuffles a fresh deck from a 32-byte seed (the VRF output) with
/// Fisher–Yates: walk from the last card down, swapping each with a random
/// card at or before it. Each swap gets its own random number,
/// sha256(seed ‖ i), so one 32-byte seed drives all 51 swaps.
/// Same seed → same deck, so anyone holding the seed can rebuild it:
/// never log the seed.
pub fn shuffle(seed: &[u8; 32]) -> [Card; DECK_SIZE] {
    let mut deck: [Card; DECK_SIZE] = core::array::from_fn(|i| i as Card);
    for i in (1..DECK_SIZE).rev() {
        let h = solana_sha256_hasher::hashv(&[seed, &[i as u8]]).to_bytes();
        // A u64 mod a number ≤ 52 has a bias of ~1 in 10^17: negligible.
        let r = u64::from_le_bytes(h[..8].try_into().unwrap());
        let j = (r % (i as u64 + 1)) as usize;
        deck.swap(i, j);
    }
    deck
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shuffle_is_a_permutation_of_all_52_cards() {
        let mut deck = shuffle(&[7u8; 32]);
        deck.sort();
        assert_eq!(deck, core::array::from_fn(|i| i as Card));
    }

    #[test]
    fn shuffle_is_deterministic_per_seed() {
        assert_eq!(shuffle(&[1u8; 32]), shuffle(&[1u8; 32]));
        assert_ne!(shuffle(&[1u8; 32]), shuffle(&[2u8; 32]));
    }

    #[test]
    fn shuffle_moves_cards() {
        let identity: [Card; DECK_SIZE] = core::array::from_fn(|i| i as Card);
        assert_ne!(shuffle(&[0u8; 32]), identity);
    }

    /// "As" -> Ace of spades. Ranks: 23456789TJQKA, suits: cdhs.
    fn card(s: &str) -> Card {
        let b = s.as_bytes();
        let r = b"23456789TJQKA".iter().position(|&x| x == b[0]).unwrap() as u8;
        let su = b"cdhs".iter().position(|&x| x == b[1]).unwrap() as u8;
        su * 13 + r
    }

    fn hand(s: &str) -> [Card; 5] {
        let v: Vec<Card> = s.split(' ').map(card).collect();
        v.try_into().unwrap()
    }

    fn category(s: &str) -> u32 {
        rank_five(hand(s)) >> 20
    }

    #[test]
    fn card_encoding() {
        assert_eq!(rank(card("2c")), 0);
        assert_eq!(rank(card("As")), 12);
        assert_eq!(suit(card("As")), 3);
        assert_eq!(card("As"), 51);
    }

    #[test]
    fn categories() {
        assert_eq!(category("Ah Kd 9c 7s 2h"), HIGH_CARD);
        assert_eq!(category("Ah Ad 9c 7s 2h"), PAIR);
        assert_eq!(category("Ah Ad 9c 9s 2h"), TWO_PAIR);
        assert_eq!(category("Ah Ad Ac 7s 2h"), THREE_OF_A_KIND);
        assert_eq!(category("9h 8d 7c 6s 5h"), STRAIGHT);
        assert_eq!(category("Ah 2d 3c 4s 5h"), STRAIGHT);
        assert_eq!(category("Ah Jh 9h 7h 2h"), FLUSH);
        assert_eq!(category("Ah Ad Ac 7s 7h"), FULL_HOUSE);
        assert_eq!(category("Ah Ad Ac As 2h"), FOUR_OF_A_KIND);
        assert_eq!(category("9h 8h 7h 6h 5h"), STRAIGHT_FLUSH);
    }

    #[test]
    fn categories_beat_each_other_in_order() {
        let ladder = [
            "Ah Kd 9c 7s 2h",
            "2h 2d 3c 4s 6h",
            "2h 2d 3c 3s 4h",
            "2h 2d 2c 3s 4h",
            "Ah 2d 3c 4s 5h",
            "2h 3h 4h 5h 7h",
            "2h 2d 2c 3s 3h",
            "2h 2d 2c 2s 3h",
            "Ah 2h 3h 4h 5h",
        ];
        for pair in ladder.windows(2) {
            assert!(
                rank_five(hand(pair[1])) > rank_five(hand(pair[0])),
                "{} should beat {}",
                pair[1],
                pair[0]
            );
        }
    }

    #[test]
    fn wheel_is_lowest_straight() {
        assert!(rank_five(hand("6h 5d 4c 3s 2h")) > rank_five(hand("Ah 2d 3c 4s 5h")));
    }

    #[test]
    fn kickers_decide() {
        assert!(rank_five(hand("Kh Kd Ac 7s 2h")) > rank_five(hand("Ks Kc Qc 7d 2d")));
        assert!(rank_five(hand("Kh Kd 7c 7s 2h")) > rank_five(hand("Ks Kc 6c 6d Ad")));
        assert!(rank_five(hand("Ah Ad Ac 2s 2h")) > rank_five(hand("Kh Kd Kc As Ac")));
    }

    #[test]
    fn same_ranks_split() {
        assert_eq!(
            rank_five(hand("Ad Kh 9s 7c 2d")),
            rank_five(hand("Ah Kd 9c 7s 2h"))
        );
    }

    #[test]
    fn fifth_card_breaks_a_flush_tie() {
        assert!(rank_five(hand("Ah Jh 9h 7h 3h")) > rank_five(hand("As Js 9s 7s 2s")));
    }

    /// Two hole cards + five board cards, e.g. seven("Ah Kd", "Qc Jc Tc 2s 3h").
    fn seven(hole: &str, board: &str) -> [Card; 7] {
        let v: Vec<Card> = hole.split(' ').chain(board.split(' ')).map(card).collect();
        v.try_into().unwrap()
    }

    #[test]
    fn board_plays_and_splits() {
        let board = "As Ks Qd Jc Th";
        assert_eq!(
            best_of_seven(seven("2c 3d", board)),
            best_of_seven(seven("4c 5d", board))
        );
    }

    #[test]
    fn six_card_flush_uses_top_five() {
        assert_eq!(
            best_of_seven(seven("Ah 2h", "Kh Qh 9h 7h 3c")),
            rank_five(hand("Ah Kh Qh 9h 7h"))
        );
    }

    #[test]
    fn flush_beats_straight_in_same_seven() {
        // Has 9-8-7-6-5 straight and a K-high heart flush.
        assert_eq!(best_of_seven(seven("9h 2h", "8h 7c 6d 5h Kh")) >> 20, FLUSH);
    }

    #[test]
    fn three_pairs_keeps_best_two_and_kicker() {
        // Pairs of K, Q, 7 + an Ace: best is K K Q Q A.
        assert_eq!(
            best_of_seven(seven("Qc Qd", "Kh Ks 7c 7d Ah")),
            rank_five(hand("Kh Ks Qc Qd Ah"))
        );
    }
}
