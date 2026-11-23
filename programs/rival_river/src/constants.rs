// constants.rs

/// Most members any of our permissions will ever list (Game: both players).
/// Each delegated account is pre-funded for a permission this size in
/// init_game, since it pays its own permission rent on the rollup.
pub const MAX_PERMISSION_MEMBERS: usize = 2;
