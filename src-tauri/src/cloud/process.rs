use super::codec::{Cloud, Result};
use kiddo::{Eytzinger, FlatVec, KdTree, SquaredEuclidean};
use rayon::prelude::*;
use serde::Deserialize;
use std::{collections::HashMap, num::NonZeroUsize, sync::OnceLock};

#[derive(Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Operation {
    Voxel {
        size: f64,
    },
    Sor {
        k: usize,
        sigma: f64,
    },
    Radius {
        radius: f64,
        min: usize,
    },
    Select {
        matrix: [f64; 16],
        planes: Vec<[f64; 4]>,
        region: Region,
    },
}
#[derive(Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Region {
    Box { min: [f64; 3], max: [f64; 3] },
    Polygon { vertices: Vec<[f64; 2]> },
}
pub fn finite(p: &[f64; 3]) -> bool {
    p.iter().all(|v| v.is_finite())
}
pub fn transform(p: [f64; 3], m: &[f64; 16]) -> [f64; 4] {
    std::array::from_fn(|r| m[r] * p[0] + m[r + 4] * p[1] + m[r + 8] * p[2] + m[r + 12])
}
pub fn polygon(p: [f64; 2], v: &[[f64; 2]]) -> bool {
    let mut inside = false;
    let mut a = v[v.len() - 1];
    for &b in v {
        let cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
        if cross.abs() <= 1e-10
            && p[0] >= a[0].min(b[0]) - 1e-10
            && p[0] <= a[0].max(b[0]) + 1e-10
            && p[1] >= a[1].min(b[1]) - 1e-10
            && p[1] <= a[1].max(b[1]) + 1e-10
        {
            return true;
        }
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]
        {
            inside = !inside;
        }
        a = b;
    }
    inside
}
type Tree = KdTree<f64, u32, Eytzinger, FlatVec<f64, u32, 3, 32>, 3, 32>;
fn pool() -> &'static rayon::ThreadPool {
    static POOL: OnceLock<rayon::ThreadPool> = OnceLock::new();
    POOL.get_or_init(|| {
        rayon::ThreadPoolBuilder::new()
            .num_threads(4)
            .build()
            .expect("point processing pool")
    })
}

pub fn run(
    cloud: &Cloud,
    active: &[u32],
    op: &Operation,
    check: &mut impl FnMut(usize, usize) -> Result<()>,
) -> Result<Vec<u32>> {
    let mut ids = Vec::with_capacity(active.len());
    for (i, &id) in active.iter().enumerate() {
        if i % 16384 == 0 {
            check(i, active.len())?;
        }
        if finite(&cloud.positions[id as usize]) {
            // Bound squared distances and population-variance sums before building the tree.
            if matches!(op, Operation::Sor { .. } | Operation::Radius { .. })
                && cloud.positions[id as usize].iter().any(|v| v.abs() > 1e150)
            {
                return Err("SOR/반경 계산 범위를 넘는 좌표입니다 (절댓값 ≤ 1e150 필요)".into());
            }
            ids.push(id);
        }
    }
    let n = ids.len();
    match op {
        Operation::Voxel { size } => {
            if !size.is_finite() || *size <= 0. {
                return Err("복셀 크기는 양수여야 합니다".into());
            }
            let mut voxels = HashMap::<[i64; 3], (u32, f64)>::new();
            for (i, &id) in ids.iter().enumerate() {
                if i % 8192 == 0 {
                    check(i, n)?;
                }
                let p = cloud.positions[id as usize];
                let scaled = p.map(|x| (x / size).floor());
                if scaled.iter().any(|x| !x.is_finite() || x.abs() > 9e15) {
                    return Err("좌표에 비해 복셀 크기가 너무 작습니다".into());
                }
                let key = scaled.map(|x| x as i64);
                let d = (0..3)
                    .map(|a| ((p[a] / size) - (scaled[a] + 0.5)).powi(2))
                    .sum();
                let entry = voxels.entry(key).or_insert((id, d));
                if d < entry.1 || (d == entry.1 && id < entry.0) {
                    *entry = (id, d);
                }
            }
            let mut result = voxels.into_values().map(|v| v.0).collect::<Vec<_>>();
            result.sort_unstable();
            check(n, n)?;
            Ok(result)
        }
        Operation::Select {
            matrix,
            planes,
            region,
        } => {
            if matrix
                .iter()
                .chain(planes.iter().flatten())
                .any(|x| !x.is_finite())
                || planes.len() > 16
            {
                return Err("선택 변환 오류".into());
            }
            match region {
                Region::Box { min, max } => {
                    if (0..3).any(|a| !min[a].is_finite() || !max[a].is_finite() || min[a] > max[a])
                    {
                        return Err("박스 범위 오류".into());
                    }
                }
                Region::Polygon { vertices } => {
                    if vertices.len() < 3
                        || vertices.len() > 4096
                        || vertices.iter().flatten().any(|x| !x.is_finite())
                    {
                        return Err("다각형은 3~4096개의 유효한 꼭짓점이 필요합니다".into());
                    }
                }
            }
            let mut result = vec![];
            for (i, &id) in ids.iter().enumerate() {
                if i % 16384 == 0 {
                    check(i, n)?;
                }
                let p = cloud.positions[id as usize];
                // Planes are already transformed into source coordinates by the frontend.
                if planes
                    .iter()
                    .any(|v| v[0] * p[0] + v[1] * p[1] + v[2] * p[2] + v[3] < 0.)
                {
                    continue;
                }
                let q = transform(p, matrix);
                let yes = match region {
                    Region::Box { min, max } => (0..3).all(|a| q[a] >= min[a] && q[a] <= max[a]),
                    Region::Polygon { vertices } => {
                        q[3] > 0.
                            && q[2] >= -q[3]
                            && q[2] <= q[3]
                            && polygon([q[0] / q[3], q[1] / q[3]], vertices)
                    }
                };
                if yes {
                    result.push(id);
                }
            }
            check(n, n)?;
            Ok(result)
        }
        Operation::Sor { k, sigma } => {
            if *k == 0 || *k > 1024 || !sigma.is_finite() || *sigma < 0. {
                return Err("SOR: k=1~1024, 배수≥0이 필요합니다".into());
            }
            if n <= *k {
                return Err("SOR 이웃 수보다 점이 많아야 합니다".into());
            }
            let points = ids
                .iter()
                .map(|&id| cloud.positions[id as usize])
                .collect::<Vec<_>>();
            check(0, n)?;
            let tree = Tree::new_from_slice(&points).map_err(|e| e.to_string())?;
            check(0, n)?;
            let mut means = Vec::with_capacity(n);
            for start in (0..n).step_by(4096) {
                check(start, n)?;
                let end = (start + 4096).min(n);
                let batch = pool().install(|| {
                    (start..end)
                        .into_par_iter()
                        .map(|i| {
                            let nearest = tree
                                .query(&points[i])
                                .nearest_n::<SquaredEuclidean<f64>>(
                                    NonZeroUsize::new(k + 1).unwrap(),
                                )
                                .execute();
                            nearest
                                .iter()
                                .filter(|v| v.item as usize != i)
                                .take(*k)
                                .map(|v| v.distance.sqrt())
                                .sum::<f64>()
                                / (*k as f64)
                        })
                        .collect::<Vec<_>>()
                });
                means.extend(batch);
            }
            let mean = means.iter().sum::<f64>() / n as f64;
            let sd = (means.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / n as f64).sqrt();
            let limit = mean + sigma * sd;
            let result = ids
                .into_iter()
                .zip(means)
                .filter_map(|(id, v)| (v <= limit).then_some(id))
                .collect();
            check(n, n)?;
            Ok(result)
        }
        Operation::Radius { radius, min } => {
            if !radius.is_finite()
                || *radius <= 0.
                || !radius.powi(2).is_finite()
                || *min == 0
                || *min > 1024
            {
                return Err("반경은 양수, 이웃 수는 1~1024여야 합니다".into());
            }
            if n <= *min {
                return Ok(vec![]);
            }
            let points = ids
                .iter()
                .map(|&id| cloud.positions[id as usize])
                .collect::<Vec<_>>();
            check(0, n)?;
            let tree = Tree::new_from_slice(&points).map_err(|e| e.to_string())?;
            check(0, n)?;
            let mut result = vec![];
            for start in (0..n).step_by(4096) {
                check(start, n)?;
                let end = (start + 4096).min(n);
                let batch = pool().install(|| {
                    (start..end)
                        .into_par_iter()
                        .filter_map(|i| {
                            let nearest = tree
                                .query(&points[i])
                                .nearest_n::<SquaredEuclidean<f64>>(
                                    NonZeroUsize::new(min + 1).unwrap(),
                                )
                                .execute();
                            (nearest
                                .iter()
                                .filter(|v| v.item as usize != i && v.distance <= radius * radius)
                                .count()
                                >= *min)
                                .then_some(ids[i])
                        })
                        .collect::<Vec<_>>()
                });
                result.extend(batch);
            }
            check(n, n)?;
            Ok(result)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extreme_neighbor_coordinates_and_cancellation_are_errors() {
        let c = cloud(&[[1e200, 0., 0.]; 3]);
        for op in [
            Operation::Sor { k: 1, sigma: 2. },
            Operation::Radius { radius: 1., min: 1 },
        ] {
            assert!(run(&c, &[0, 1, 2], &op, &mut |_, _| Ok(())).is_err());
        }
        let c = cloud(&[[0., 0., 0.]; 3]);
        assert!(
            run(
                &c,
                &[0, 1, 2],
                &Operation::Voxel { size: 1. },
                &mut |_, _| Err("cancel".into())
            )
            .is_err()
        );
    }
    #[test]
    fn box_selection_includes_boundary_and_obeys_clipping() {
        let c = cloud(&[[0., 0., 0.], [1., 1., 1.], [-1., 0., 0.], [0.5, 0.5, 0.5]]);
        let op = Operation::Select {
            matrix: [
                1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
            ],
            planes: vec![[1., 0., 0., -0.5]],
            region: Region::Box {
                min: [0.; 3],
                max: [1.; 3],
            },
        };
        assert_eq!(
            run(&c, &[0, 1, 2, 3], &op, &mut |_, _| Ok(())).unwrap(),
            vec![1, 3]
        );
    }
    fn cloud(points: &[[f64; 3]]) -> Cloud {
        Cloud {
            format: super::super::codec::Format::Ply,
            fields: vec![],
            comments: vec![],
            bytes: vec![],
            offsets: vec![],
            positions: points.to_vec(),
            editable: true,
            warning: None,
        }
    }
    #[test]
    fn voxel_center_ties_and_negative() {
        let c = cloud(&[
            [0.25, 0.5, 0.5],
            [0.75, 0.5, 0.5],
            [-0.5, 0.5, 0.5],
            [f64::NAN, 0., 0.],
        ]);
        assert_eq!(
            run(
                &c,
                &[0, 1, 2, 3],
                &Operation::Voxel { size: 1. },
                &mut |_, _| Ok(())
            )
            .unwrap(),
            vec![0, 2]
        );
    }
    #[test]
    fn radius_excludes_self_but_counts_duplicates_and_boundary() {
        let c = cloud(&[[0., 0., 0.], [0., 0., 0.], [1., 0., 0.], [10., 0., 0.]]);
        assert_eq!(
            run(
                &c,
                &[0, 1, 2, 3],
                &Operation::Radius { radius: 1., min: 2 },
                &mut |_, _| Ok(())
            )
            .unwrap(),
            vec![0, 1, 2]
        );
    }
    #[test]
    fn sor_matches_brute_force() {
        let points = (0..100)
            .map(|i| {
                [
                    (i * 17 % 101) as f64,
                    (i * 23 % 99) as f64,
                    (i * 13 % 71) as f64,
                ]
            })
            .collect::<Vec<_>>();
        let c = cloud(&points);
        let means = points
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let mut d = points
                    .iter()
                    .enumerate()
                    .filter(|(j, _)| *j != i)
                    .map(|(_, q)| (0..3).map(|a| (p[a] - q[a]).powi(2)).sum::<f64>().sqrt())
                    .collect::<Vec<_>>();
                d.sort_by(f64::total_cmp);
                d[..5].iter().sum::<f64>() / 5.
            })
            .collect::<Vec<_>>();
        let mean = means.iter().sum::<f64>() / 100.;
        let sd = (means.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / 100.).sqrt();
        let expected = means
            .iter()
            .enumerate()
            .filter_map(|(i, &m)| (m <= mean + sd).then_some(i as u32))
            .collect::<Vec<_>>();
        assert_eq!(
            run(
                &c,
                &(0..100).collect::<Vec<_>>(),
                &Operation::Sor { k: 5, sigma: 1. },
                &mut |_, _| Ok(())
            )
            .unwrap(),
            expected
        );
    }
    #[test]
    fn polygon_includes_boundary() {
        let v = [[0., 0.], [1., 0.], [1., 1.], [0., 1.]];
        assert!(polygon([0., 0.5], &v));
        assert!(polygon([0.5, 0.5], &v));
        assert!(!polygon([2., 0.5], &v));
    }
}
