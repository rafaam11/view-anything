//! LAS/LAZ attributed-point codec.
use super::codec::{MAX_BYTES, MAX_POINTS, Result};
use std::io::{Read, Seek, Write};

#[derive(Clone, Debug)]
pub struct LasCloud {
    pub header: las::Header,
    pub points: Vec<las::Point>,
}

/// Materialize display records without discarding the original attributed LAS points.
pub fn into_cloud(las: LasCloud) -> Result<super::codec::Cloud> {
    use super::codec::{Cloud, Field, Format, Scalar};
    let format = *las.header.point_format();
    let mut fields = vec![];
    for name in ["x", "y", "z"] {
        fields.push(Field {
            name: name.into(),
            scalar: Scalar::F64,
            count: 1,
            list: None,
        });
    }
    fields.push(Field {
        name: "intensity".into(),
        scalar: Scalar::U16,
        count: 1,
        list: None,
    });
    for name in [
        "return_number",
        "number_of_returns",
        "classification",
        "user_data",
    ] {
        fields.push(Field {
            name: name.into(),
            scalar: Scalar::U8,
            count: 1,
            list: None,
        });
    }
    if format.has_gps_time {
        fields.push(Field {
            name: "gps_time".into(),
            scalar: Scalar::F64,
            count: 1,
            list: None,
        });
    }
    if format.has_color {
        for name in ["red", "green", "blue"] {
            fields.push(Field {
                name: name.into(),
                scalar: Scalar::U16,
                count: 1,
                list: None,
            });
        }
    }
    if format.extra_bytes > 0 {
        fields.push(Field {
            name: "extra_bytes".into(),
            scalar: Scalar::U8,
            count: format.extra_bytes as usize,
            list: None,
        });
    }
    let len = las.points.len();
    let stride = 30usize
        + if format.has_gps_time { 8 } else { 0 }
        + if format.has_color { 6 } else { 0 }
        + format.extra_bytes as usize;
    let size = len
        .checked_mul(stride)
        .filter(|v| *v <= MAX_BYTES)
        .ok_or("LAS/LAZ 디코딩 데이터 한도를 초과합니다")?;
    let mut bytes = Vec::with_capacity(size);
    let mut offsets = Vec::with_capacity(len + 1);
    let mut positions = Vec::with_capacity(len);
    for point in &las.points {
        offsets.push(u32::try_from(bytes.len()).map_err(|_| "LAS/LAZ 오프셋 한도 오류")?);
        positions.push([point.x, point.y, point.z]);
        for n in [point.x, point.y, point.z] {
            bytes.extend_from_slice(&n.to_le_bytes());
        }
        bytes.extend_from_slice(&point.intensity.to_le_bytes());
        bytes.extend_from_slice(&[
            point.return_number,
            point.number_of_returns,
            u8::from(point.classification),
            point.user_data,
        ]);
        if format.has_gps_time {
            bytes.extend_from_slice(
                &point
                    .gps_time
                    .ok_or("LAS GPS 시간이 누락되었습니다")?
                    .to_le_bytes(),
            );
        }
        if format.has_color {
            let c = point.color.ok_or("LAS 색상 정보가 누락되었습니다")?;
            for value in [c.red, c.green, c.blue] {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
        }
        if point.extra_bytes.len() != format.extra_bytes as usize {
            return Err("LAS 추가 속성 크기가 다릅니다".into());
        }
        bytes.extend_from_slice(&point.extra_bytes);
    }
    offsets.push(u32::try_from(bytes.len()).map_err(|_| "LAS/LAZ 오프셋 한도 오류")?);
    Ok(Cloud {
        format: Format::Las(Box::new(las)),
        fields,
        comments: vec![],
        bytes,
        offsets,
        positions,
        editable: true,
        warning: None,
    })
}

#[allow(dead_code)]
pub fn read<R: Read + Seek + Send + Sync + 'static>(
    reader: R,
    budget: usize,
    check: &mut impl FnMut(usize, usize) -> Result<()>,
) -> Result<LasCloud> {
    let mut reader = las::Reader::new(reader).map_err(|e| e.to_string())?;
    let header = reader.header().clone();
    if header.point_format().has_waveform {
        return Err("파형 데이터가 포함된 LAS/LAZ는 보존 저장할 수 없습니다".into());
    }
    let transforms = header.transforms();
    for t in [transforms.x, transforms.y, transforms.z] {
        let max_coordinate = t.offset.abs() + t.scale.abs() * (i32::MAX as f64 + 1.);
        if !t.scale.is_finite()
            || t.scale <= 0.
            || !t.offset.is_finite()
            || !max_coordinate.is_finite()
            || max_coordinate * f64::EPSILON * 2. >= t.scale
        {
            return Err("LAS 좌표의 정밀도를 보존할 수 없습니다".into());
        }
    }
    if header
        .vlrs()
        .iter()
        .chain(header.evlrs())
        .any(|v| v.user_id.eq_ignore_ascii_case("copc"))
    {
        return Err("COPC 계층 정보는 보존 저장할 수 없습니다".into());
    }
    let count = usize::try_from(header.number_of_points()).map_err(|_| "점 개수가 너무 큽니다")?;
    if count > MAX_POINTS {
        return Err("점 개수 한도를 초과합니다".into());
    }
    let per_point = std::mem::size_of::<las::Point>()
        .checked_add(header.point_format().extra_bytes as usize)
        .and_then(|n| n.checked_add(320))
        .ok_or("메모리 한도 오류")?;
    let estimated = count.checked_mul(per_point).ok_or("메모리 한도 오류")?;
    if estimated > budget || count.checked_mul(per_point).is_none_or(|n| n > MAX_BYTES) {
        return Err("LAS/LAZ 디코딩 메모리 한도를 초과합니다".into());
    }
    let mut points = Vec::with_capacity(count);
    for i in 0..count {
        if i % 4096 == 0 {
            check(i, count)?;
        }
        let point = reader
            .read_point()
            .map_err(|e| e.to_string())?
            .ok_or("LAS/LAZ 점 데이터가 잘렸습니다")?;
        if ![point.x, point.y, point.z].iter().all(|v| v.is_finite()) {
            return Err("유효하지 않은 LAS/LAZ 좌표입니다".into());
        }
        points.push(point);
    }
    check(count, count)?;
    Ok(LasCloud { header, points })
}

/// Writes selected original points and metadata. The caller owns atomic file replacement.
#[allow(dead_code)]
pub fn write<W: Write + Seek + Send + Sync + 'static>(
    cloud: &LasCloud,
    ids: &[u32],
    out: W,
    check: &mut impl FnMut(usize, usize) -> Result<()>,
) -> Result<W> {
    let mut writer = las::Writer::new(out, cloud.header.clone()).map_err(|e| e.to_string())?;
    for (i, id) in ids.iter().enumerate() {
        if i % 4096 == 0 {
            check(i, ids.len())?;
        }
        let point = cloud.points.get(*id as usize).ok_or("점 ID 오류")?;
        writer
            .write_point(point.clone())
            .map_err(|e| e.to_string())?;
    }
    check(ids.len(), ids.len())?;
    writer.into_inner().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    #[test]
    fn las_and_laz_keep_extra_bytes_metadata_and_selected_points() {
        for compressed in [false, true] {
            let mut builder = las::Builder::from((1, 4));
            builder.point_format = las::point::Format::new(3).unwrap();
            builder.point_format.extra_bytes = 3;
            builder.point_format.is_compressed = compressed;
            builder.vlrs.push(las::Vlr {
                user_id: "test".into(),
                record_id: 42,
                description: "metadata".into(),
                data: vec![4, 5, 6],
            });
            let header = builder.into_header().unwrap();
            let mk = |x| las::Point {
                x,
                y: 2.,
                z: 3.,
                intensity: 123,
                return_number: 1,
                number_of_returns: 1,
                gps_time: Some(42.),
                color: Some(las::Color {
                    red: 65535,
                    green: 30000,
                    blue: 500,
                }),
                extra_bytes: vec![7, 8, 9],
                ..Default::default()
            };
            let mut writer = las::Writer::new(Cursor::new(Vec::new()), header).unwrap();
            writer.write_point(mk(1.)).unwrap();
            writer.write_point(mk(4.)).unwrap();
            let mut cursor = writer.into_inner().unwrap();
            cursor.set_position(0);
            let cloud = read(cursor, 1_000_000, &mut |_, _| Ok(())).unwrap();
            let display = into_cloud(cloud.clone()).unwrap();
            assert_eq!(display.value(1, "red"), Some(65535.));
            assert_eq!(display.rgb(1), Some([255, 116, 1]));
            let mut output =
                write(&cloud, &[1], Cursor::new(Vec::new()), &mut |_, _| Ok(())).unwrap();
            output.set_position(0);
            let result = read(output, 1_000_000, &mut |_, _| Ok(())).unwrap();
            assert_eq!(result.points, vec![mk(4.)]);
            assert!(
                result
                    .header
                    .vlrs()
                    .iter()
                    .any(|v| v.user_id == "test" && v.data == [4, 5, 6])
            );
            assert_eq!(result.header.point_format().is_compressed, compressed);
        }
    }

    #[test]
    fn rejects_waveforms_and_respects_budget_and_cancellation() {
        let mut builder = las::Builder::from((1, 4));
        builder.point_format = las::point::Format::new(4).unwrap();
        let writer =
            las::Writer::new(Cursor::new(Vec::new()), builder.into_header().unwrap()).unwrap();
        let mut input = writer.into_inner().unwrap();
        input.set_position(0);
        assert!(
            read(input, 1_000_000, &mut |_, _| Ok(()))
                .unwrap_err()
                .contains("파형")
        );
        let mut writer = las::Writer::new(Cursor::new(Vec::new()), las::Header::default()).unwrap();
        writer.write_point(las::Point::default()).unwrap();
        let mut input = writer.into_inner().unwrap();
        input.set_position(0);
        assert!(read(input.clone(), 1, &mut |_, _| Ok(())).is_err());
        assert!(read(input, 1_000_000, &mut |_, _| Err("cancelled".into())).is_err());
    }
}
