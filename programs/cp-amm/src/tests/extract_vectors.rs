use crate::curve;

#[test]
fn extract_and_print_reserve_vectors() {
    // Vectors to extract: (liquidity, sqrt_min, sqrt_price, sqrt_max)
    let vectors: &[(u128, u128, u128, u128)] = &[
        (1_000_000_000u128, 1u128 << 64, 2u128 << 64, 4u128 << 64),
        (
            5_000_000_000u128,
            (3u128 << 64) / 2u128,
            2u128 << 64,
            8u128 << 64,
        ),
        (10_000_000_000u128, 1u128 << 64, 3u128 << 64, 6u128 << 64),
        // additional vectors for coverage
        (1_000_000_000u128, 1u128 << 64, 1u128 << 64, 2u128 << 64),
        (
            2_000_000_000u128,
            (5u128 << 64) / 4u128,
            (7u128 << 64) / 4u128,
            4u128 << 64,
        ),
    ];

    for (i, (liquidity, smin, sp, smax)) in vectors.iter().enumerate() {
        match curve::get_initialize_amounts(*smin, *smax, *sp, *liquidity) {
            Ok((a, b)) => println!("V{}: liquidity={} sqrt_min={} sqrt_price={} sqrt_max={} => reserve_a={} reserve_b={}", i, liquidity, smin, sp, smax, a, b),
            Err(e) => println!("V{}: error computing reserves: {:?}", i, e),
        }
    }
}
