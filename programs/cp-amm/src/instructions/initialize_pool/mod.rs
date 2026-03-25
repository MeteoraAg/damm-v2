pub mod ix_initialize_pool;
pub use ix_initialize_pool::*;
pub mod ix_initialize_customizable_pool;
pub use ix_initialize_customizable_pool::*;
pub mod ix_initialize_pool_with_dynamic_config;
pub use ix_initialize_pool_with_dynamic_config::*;

pub(crate) fn required_badge_indices(
    token_a_requires_badge: bool,
    token_b_requires_badge: bool,
) -> (Option<usize>, Option<usize>) {
    let mut next_idx = 0usize;
    let token_a_badge_idx = if token_a_requires_badge {
        let idx = next_idx;
        next_idx += 1;
        Some(idx)
    } else {
        None
    };
    let token_b_badge_idx = if token_b_requires_badge {
        Some(next_idx)
    } else {
        None
    };
    (token_a_badge_idx, token_b_badge_idx)
}

#[cfg(test)]
mod tests {
    use super::required_badge_indices;

    #[test]
    fn badge_indices_when_no_badges_needed() {
        let indices = required_badge_indices(false, false);
        assert_eq!(indices, (None, None));
    }

    #[test]
    fn badge_indices_when_only_token_a_needs_badge() {
        let indices = required_badge_indices(true, false);
        assert_eq!(indices, (Some(0), None));
    }

    #[test]
    fn badge_indices_when_only_token_b_needs_badge() {
        let indices = required_badge_indices(false, true);
        assert_eq!(indices, (None, Some(0)));
    }

    #[test]
    fn badge_indices_when_both_tokens_need_badges() {
        let indices = required_badge_indices(true, true);
        assert_eq!(indices, (Some(0), Some(1)));
    }
}
