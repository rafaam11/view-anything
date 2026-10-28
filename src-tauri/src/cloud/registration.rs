//! Bounded point-to-point rigid ICP. Inputs are in the current scene coordinate frame.
use super::codec::Result;
use kiddo::{Eytzinger, FlatVec, KdTree, SquaredEuclidean};
use nalgebra::{Matrix3, Vector3};
use std::num::NonZeroUsize;

type Tree = KdTree<f64, u32, Eytzinger, FlatVec<f64, u32, 3, 32>, 3, 32>;
const MAX_SAMPLE: usize = 100_000;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Registration {
    /// Column-major rigid transform in scene coordinates.
    pub matrix: [f64; 16],
    pub pairs: usize,
    pub sampled_source: usize,
    pub sampled_target: usize,
    pub fitness: f64,
    pub rmse: f64,
    pub iterations: usize,
    pub converged: bool,
}

fn sample(points: &[[f64; 3]]) -> Vec<[f64; 3]> {
    let step = points.len().div_ceil(MAX_SAMPLE).max(1);
    points
        .iter()
        .step_by(step)
        .copied()
        .filter(|p| p.iter().all(|x| x.is_finite() && x.abs() <= 1e150))
        .collect()
}

/// Align source to target from their displayed initial positions; reports errors instead of
/// returning arbitrary rotations for insufficient or collinear correspondences.
#[allow(dead_code)]
pub fn align(
    source: &[[f64; 3]],
    target: &[[f64; 3]],
    max_distance: f64,
    max_iterations: usize,
    check: &mut impl FnMut(usize, usize) -> Result<()>,
) -> Result<Registration> {
    if !max_distance.is_finite()
        || max_distance <= 0.
        || max_distance > 1e150
        || max_iterations == 0
        || max_iterations > 200
    {
        return Err("정합 거리 또는 반복 횟수가 잘못되었습니다".into());
    }
    let source = sample(source);
    let target = sample(target);
    if source.len() < 3 || target.len() < 3 {
        return Err("정합에는 유효한 점이 각각 3개 이상 필요합니다".into());
    }
    check(0, max_iterations)?;
    let tree = Tree::new_from_slice(&target).map_err(|e| e.to_string())?;
    let mut rotation = Matrix3::<f64>::identity();
    let mut translation = Vector3::<f64>::zeros();
    let mut previous = f64::INFINITY;
    let mut pairs = 0;
    let mut rmse = f64::INFINITY;
    let mut iterations = 0;
    let mut converged = false;
    for iteration in 0..max_iterations {
        check(iteration, max_iterations)?;
        let mut correspondence = Vec::with_capacity(source.len());
        for (i, p) in source.iter().enumerate() {
            if i % 4096 == 0 {
                check(iteration, max_iterations)?;
            }
            let p = rotation * Vector3::from(*p) + translation;
            let q = [p.x, p.y, p.z];
            let hit = tree
                .query(&q)
                .nearest_n::<SquaredEuclidean<f64>>(NonZeroUsize::new(1).unwrap())
                .execute();
            if let Some(hit) = hit.first() {
                if hit.distance <= max_distance * max_distance {
                    correspondence.push((p, Vector3::from(target[hit.item as usize])));
                }
            }
        }
        pairs = correspondence.len();
        if pairs < 3 {
            return Err("대응점이 3개 미만입니다. 정합 거리나 초기 위치를 확인하세요".into());
        }
        let count = pairs as f64;
        let center_p = correspondence
            .iter()
            .fold(Vector3::zeros(), |a, (p, _)| a + p)
            / count;
        let center_q = correspondence
            .iter()
            .fold(Vector3::zeros(), |a, (_, q)| a + q)
            / count;
        let covariance = correspondence.iter().fold(Matrix3::zeros(), |a, (p, q)| {
            a + (p - center_p) * (q - center_q).transpose()
        });
        let svd = covariance.svd(true, true);
        if !svd.singular_values.iter().all(|v| v.is_finite())
            || svd.singular_values[1] <= svd.singular_values[0] * 1e-12
            || svd.singular_values[0] <= f64::EPSILON
        {
            return Err("대응점이 퇴화하여 회전을 결정할 수 없습니다".into());
        }
        let u = svd.u.ok_or("정합 분해 오류")?;
        let vt = svd.v_t.ok_or("정합 분해 오류")?;
        let mut sign = Matrix3::identity();
        sign[(2, 2)] = if (vt.transpose() * u.transpose()).determinant() < 0. {
            -1.
        } else {
            1.
        };
        let delta = vt.transpose() * sign * u.transpose();
        let offset = center_q - delta * center_p;
        rotation = delta * rotation;
        translation = delta * translation + offset;
        rmse = (correspondence
            .iter()
            .map(|(p, q)| (delta * p + offset - q).norm_squared())
            .sum::<f64>()
            / count)
            .sqrt();
        if !rmse.is_finite() || !translation.iter().all(|v| v.is_finite()) {
            return Err("정합 계산 범위를 초과했습니다".into());
        }
        iterations = iteration + 1;
        if (previous - rmse).abs() <= 1e-8 * (1. + previous.abs().min(1e100)) {
            converged = true;
            break;
        }
        previous = rmse;
    }
    check(max_iterations, max_iterations)?;
    let mut matrix = [0.; 16];
    for col in 0..3 {
        for row in 0..3 {
            matrix[col * 4 + row] = rotation[(row, col)];
        }
    }
    matrix[12] = translation.x;
    matrix[13] = translation.y;
    matrix[14] = translation.z;
    matrix[15] = 1.;
    Ok(Registration {
        matrix,
        pairs,
        sampled_source: source.len(),
        sampled_target: target.len(),
        fitness: pairs as f64 / source.len() as f64,
        rmse,
        iterations,
        converged,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn aligns_translation_and_rejects_degenerate_data() {
        let a = [
            [0., 0., 0.],
            [5., 0., 0.],
            [0., 7., 0.],
            [0., 0., 9.],
            [4., 3., 8.],
        ];
        let b = a.map(|p| [p[0] + 0.1, p[1] - 0.2, p[2] + 0.3]);
        let r = align(&a, &b, 1., 30, &mut |_, _| Ok(())).unwrap();
        assert!(r.rmse < 1e-8);
        assert_eq!(r.pairs, 5);
        assert_eq!(r.sampled_source, 5);
        assert_eq!(r.sampled_target, 5);
        assert_eq!(r.fitness, 1.);
        assert!(r.converged);
        assert!(r.iterations >= 2);
        assert!(
            (r.matrix[12] - 0.1).abs() < 1e-8
                && (r.matrix[13] + 0.2).abs() < 1e-8
                && (r.matrix[14] - 0.3).abs() < 1e-8
        );
        let line = [[0., 0., 0.], [1., 0., 0.], [2., 0., 0.]];
        assert!(align(&line, &line, 1., 10, &mut |_, _| Ok(())).is_err());
        assert!(align(&a, &b, 1., 10, &mut |_, _| Err("cancelled".into())).is_err());
        assert!(!align(&a, &b, 1., 1, &mut |_, _| Ok(())).unwrap().converged);
    }
    #[test]
    fn aligns_small_rotation_without_reflection() {
        let a = [
            [0., 0., 0.],
            [5., 0., 0.],
            [0., 7., 0.],
            [0., 0., 9.],
            [4., 3., 8.],
        ];
        let angle: f64 = 0.03;
        let b = a.map(|p| {
            [
                angle.cos() * p[0] - angle.sin() * p[1] + 0.1,
                angle.sin() * p[0] + angle.cos() * p[1] - 0.2,
                p[2] + 0.3,
            ]
        });
        let r = align(&a, &b, 1., 30, &mut |_, _| Ok(())).unwrap();
        assert!(r.rmse < 1e-8);
        assert!(
            (r.matrix[0] - angle.cos()).abs() < 1e-8 && (r.matrix[1] - angle.sin()).abs() < 1e-8
        );
        assert!(
            (r.matrix[4] + angle.sin()).abs() < 1e-8 && (r.matrix[5] - angle.cos()).abs() < 1e-8
        );
    }
}
