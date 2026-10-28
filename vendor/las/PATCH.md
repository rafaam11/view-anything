# Local patch for las 0.9.11

Source: https://crates.io/crates/las/0.9.11 (MIT; see LICENSE.txt).
The writer's Drop implementation ignores close errors instead of panicking. The caller still
checks write and close results and removes its temporary output on failure. This prevents a failed
save, disk-full error, or cancellation from aborting the application during cleanup.
The deprecated `std::f64` import is also removed for compatibility with newer Rust toolchains.
