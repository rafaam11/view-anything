//! Synthetic ICP benchmark; never reads user data.
mod codec {
    pub type Result<T> = std::result::Result<T, String>;
}
#[path = "../src/cloud/registration.rs"]
mod registration;
use std::time::Instant;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let n: usize = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "1000000".into())
        .parse()?;
    if !(3..=10_000_000).contains(&n) {
        return Err("point count must be 3..10000000".into());
    }
    let limit: usize = std::env::args()
        .nth(2)
        .unwrap_or_else(|| "100000".into())
        .parse()?;
    if !(1000..=100_000).contains(&limit) {
        return Err("sample limit must be 1000..100000".into());
    }
    let mut state = 0x9e3779b97f4a7c15u64;
    let mut next = || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        (state as u32 as f64) / (u32::MAX as f64) * 1000.
    };
    let target: Vec<[f64; 3]> = (0..n).map(|_| [next(), next(), next()]).collect();
    let source: Vec<[f64; 3]> = target
        .iter()
        .map(|p| [p[0] + 0.1, p[1] - 0.2, p[2] + 0.3])
        .collect();
    let start = Instant::now();
    let step = n.div_ceil(limit).max(1);
    let source_sample: Vec<_> = source.iter().step_by(step).copied().collect();
    let target_sample: Vec<_> = target.iter().step_by(step).copied().collect();
    let result = registration::align(&source_sample, &target_sample, 1., 30, &mut |_, _| Ok(()))?;
    let error = (result.matrix[12] + 0.1)
        .abs()
        .max((result.matrix[13] - 0.2).abs())
        .max((result.matrix[14] + 0.3).abs());
    if error > 1e-6 || !result.converged {
        return Err("synthetic registration did not converge".into());
    }
    println!(
        "input={n} limit={limit} sampled={} pairs={} iterations={} seconds={:.3} rmse={:.9} translation_error={:.9}",
        result.sampled_source,
        result.pairs,
        result.iterations,
        start.elapsed().as_secs_f64(),
        result.rmse,
        error
    );
    Ok(())
}
