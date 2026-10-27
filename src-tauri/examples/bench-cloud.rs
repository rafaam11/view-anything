//! Synthetic data only, written to the OS temporary directory. Never uses private user files.
#[path = "../src/cloud/codec.rs"]
mod codec;
#[path = "../src/cloud/process.rs"]
mod process;
use std::io::{BufReader, BufWriter, Write};
use std::time::Instant;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let n: usize = std::env::args()
        .nth(1)
        .unwrap_or("1000000".into())
        .parse()?;
    if n == 0 || n > codec::MAX_POINTS {
        return Err("point count must be 1..10000000".into());
    }
    let path = std::env::temp_dir().join(format!("va-cloud-synthetic-{n}.pcd"));
    let mut w = BufWriter::new(std::fs::File::create(&path)?);
    writeln!(
        w,
        "VERSION .7\nFIELDS x y z rgb ring\nSIZE 4 4 4 4 2\nTYPE F F F U U\nCOUNT 1 1 1 1 1\nWIDTH {n}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS {n}\nDATA binary"
    )?;
    for i in 0..n {
        let x = (i % 1000) as f32 * 0.01;
        let y = (i / 1000 % 1000) as f32 * 0.01;
        let z = (i / 1_000_000) as f32 * 0.1 + (x * 3.).sin() * 0.03;
        for v in [x, y, z] {
            w.write_all(&v.to_le_bytes())?;
        }
        w.write_all(&(0x4080ffu32 + (i as u32 & 255) * 65536).to_le_bytes())?;
        w.write_all(&((i % 64) as u16).to_le_bytes())?;
    }
    w.flush()?;
    drop(w);
    println!("fixture={}", path.display());
    let begin = Instant::now();
    let codec::Parsed::Cloud(cloud) = codec::read(
        BufReader::new(std::fs::File::open(path)?),
        "pcd",
        &mut |_, _| Ok(()),
    )?
    else {
        return Err("unexpected mesh".into());
    };
    println!(
        "parse: {:?}, {} points, {} bytes",
        begin.elapsed(),
        cloud.len(),
        cloud.memory()
    );
    let ids = (0..n as u32).collect::<Vec<_>>();
    for (name, op) in [
        ("voxel", process::Operation::Voxel { size: 0.025 }),
        ("sor", process::Operation::Sor { k: 20, sigma: 2. }),
        (
            "radius",
            process::Operation::Radius {
                radius: 0.025,
                min: 5,
            },
        ),
    ] {
        let begin = Instant::now();
        let result = process::run(&cloud, &ids, &op, &mut |_, _| Ok(()))?;
        println!("{name}: {:?}, {} points", begin.elapsed(), result.len());
    }
    Ok(())
}
