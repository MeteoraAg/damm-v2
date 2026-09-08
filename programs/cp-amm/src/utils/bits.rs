/// Returns the maximum inclusive bitmask value across `variant_count` flag bits.
pub const fn bitmask_max(variant_count: usize) -> u128 {
    assert!(
        variant_count < 128,
        "variant_count must be < 128 for u128 bitmask"
    );
    (1u128 << variant_count) - 1
}
