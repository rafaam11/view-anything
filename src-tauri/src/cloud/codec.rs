//! Lossless point records in canonical little endian. No rendering or Tauri dependencies.
use std::io::{BufRead, Read, Write};

pub const MAX_POINTS: usize = 10_000_000;
pub const MAX_BYTES: usize = 2 * 1024 * 1024 * 1024;
pub type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Scalar {
    I8,
    U8,
    I16,
    U16,
    I32,
    U32,
    I64,
    U64,
    F32,
    F64,
}
impl Scalar {
    pub fn size(self) -> usize {
        match self {
            Self::I8 | Self::U8 => 1,
            Self::I16 | Self::U16 => 2,
            Self::F64 | Self::I64 | Self::U64 => 8,
            _ => 4,
        }
    }
    fn ply(self) -> &'static str {
        match self {
            Self::I8 => "char",
            Self::U8 => "uchar",
            Self::I16 => "short",
            Self::U16 => "ushort",
            Self::I32 => "int",
            Self::U32 => "uint",
            Self::I64 => "int64",
            Self::U64 => "uint64",
            Self::F32 => "float",
            Self::F64 => "double",
        }
    }
    fn from_ply(s: &str) -> Result<Self> {
        Ok(match s {
            "char" | "int8" => Self::I8,
            "uchar" | "uint8" => Self::U8,
            "short" | "int16" => Self::I16,
            "ushort" | "uint16" => Self::U16,
            "int" | "int32" => Self::I32,
            "uint" | "uint32" => Self::U32,
            "int64" => Self::I64,
            "uint64" => Self::U64,
            "float" | "float32" => Self::F32,
            "double" | "float64" => Self::F64,
            _ => return Err(format!("지원하지 않는 PLY 타입: {s}")),
        })
    }
    pub fn number(self, b: &[u8]) -> f64 {
        match self {
            Self::I8 => b[0] as i8 as f64,
            Self::U8 => b[0] as f64,
            Self::I16 => i16::from_le_bytes(b[..2].try_into().unwrap()) as f64,
            Self::U16 => u16::from_le_bytes(b[..2].try_into().unwrap()) as f64,
            Self::I32 => i32::from_le_bytes(b[..4].try_into().unwrap()) as f64,
            Self::U32 => u32::from_le_bytes(b[..4].try_into().unwrap()) as f64,
            Self::I64 => i64::from_le_bytes(b[..8].try_into().unwrap()) as f64,
            Self::U64 => u64::from_le_bytes(b[..8].try_into().unwrap()) as f64,
            Self::F32 => f32::from_le_bytes(b[..4].try_into().unwrap()) as f64,
            Self::F64 => f64::from_le_bytes(b[..8].try_into().unwrap()),
        }
    }
    pub fn text(self, b: &[u8]) -> String {
        match self {
            Self::I64 => i64::from_le_bytes(b[..8].try_into().unwrap()).to_string(),
            Self::U64 => u64::from_le_bytes(b[..8].try_into().unwrap()).to_string(),
            _ => self.number(b).to_string(),
        }
    }
    fn ascii(self, s: &str, out: &mut Vec<u8>) -> Result<()> {
        macro_rules! put {
            ($t:ty) => {
                out.extend_from_slice(
                    &s.parse::<$t>()
                        .map_err(|_| format!("잘못된 숫자: {s}"))?
                        .to_le_bytes(),
                )
            };
        }
        match self {
            Self::I8 => put!(i8),
            Self::U8 => put!(u8),
            Self::I16 => put!(i16),
            Self::U16 => put!(u16),
            Self::I32 => put!(i32),
            Self::U32 => put!(u32),
            Self::I64 => put!(i64),
            Self::U64 => put!(u64),
            Self::F32 => put!(f32),
            Self::F64 => put!(f64),
        };
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct Field {
    pub name: String,
    pub scalar: Scalar,
    pub count: usize,
    pub list: Option<Scalar>,
}
#[derive(Clone, Debug)]
pub enum Format {
    Pcd {
        width: usize,
        height: usize,
        viewpoint: String,
    },
    Ply,
    Las(Box<super::las_codec::LasCloud>),
}
pub struct Cloud {
    pub format: Format,
    pub fields: Vec<Field>,
    pub comments: Vec<String>,
    pub bytes: Vec<u8>,
    pub offsets: Vec<u32>,
    pub positions: Vec<[f64; 3]>,
    pub editable: bool,
    pub warning: Option<String>,
}
impl Cloud {
    pub fn len(&self) -> usize {
        self.positions.len()
    }
    pub fn memory(&self) -> usize {
        let las = match &self.format {
            Format::Las(c) => {
                c.points.capacity() * std::mem::size_of::<las::Point>()
                    + c.points
                        .iter()
                        .map(|p| p.extra_bytes.capacity())
                        .sum::<usize>()
            }
            _ => 0,
        };
        self.bytes.capacity() + self.offsets.capacity() * 4 + self.positions.capacity() * 24 + las
    }
    pub fn record(&self, id: u32) -> &[u8] {
        &self.bytes[self.offsets[id as usize] as usize..self.offsets[id as usize + 1] as usize]
    }
    pub fn values<'a>(&'a self, id: u32) -> impl Iterator<Item = (&'a Field, &'a [u8])> {
        let record = self.record(id);
        let mut at = 0;
        self.fields.iter().map(move |f| {
            let count = if let Some(t) = f.list {
                let n = t.number(&record[at..]) as usize;
                at += t.size();
                n
            } else {
                f.count
            };
            let start = at;
            at += count * f.scalar.size();
            (f, &record[start..at])
        })
    }
    pub fn value(&self, id: u32, name: &str) -> Option<f64> {
        self.values(id)
            .find(|(f, b)| f.name == name && b.len() == f.scalar.size())
            .map(|(f, b)| f.scalar.number(b))
    }
    pub fn rgb(&self, id: u32) -> Option<[u8; 3]> {
        let mut rgb = [0; 3];
        let mut found = 0;
        for (f, b) in self.values(id) {
            if (f.name == "rgb" || f.name == "rgba") && b.len() == 4 {
                let n = u32::from_le_bytes(b.try_into().unwrap());
                return Some([(n >> 16) as u8, (n >> 8) as u8, n as u8]);
            }
            let channel = match f.name.as_str() {
                "red" | "r" => 0,
                "green" | "g" => 1,
                "blue" | "b" => 2,
                _ => continue,
            };
            if b.len() == f.scalar.size() {
                let value = f.scalar.number(b);
                rgb[channel] = if matches!(self.format, Format::Las(_)) && f.scalar == Scalar::U16 {
                    (value / 257.).clamp(0., 255.) as u8
                } else {
                    value.clamp(0., 255.) as u8
                };
                found |= 1 << channel;
            }
        }
        (found == 7).then_some(rgb)
    }
}

fn checked_size(n: usize, size: usize) -> Result<usize> {
    n.checked_mul(size)
        .filter(|&x| x <= MAX_BYTES)
        .ok_or_else(|| "디코딩 데이터 2GiB 한도를 초과합니다".into())
}
fn count(s: &str) -> Result<usize> {
    s.parse().map_err(|_| "잘못된 개수".into())
}
fn line<R: BufRead>(r: &mut R, total: &mut usize) -> Result<String> {
    let mut b = Vec::new();
    r.take(65_537)
        .read_until(b'\n', &mut b)
        .map_err(|e| e.to_string())?;
    *total += b.len();
    if b.is_empty() || b.len() > 65_536 || *total > 1_048_576 {
        return Err("헤더가 없거나 너무 큽니다".into());
    }
    String::from_utf8(b)
        .map(|s| s.trim().to_owned())
        .map_err(|_| "헤더가 UTF-8이 아닙니다".into())
}
pub enum Parsed {
    Cloud(Cloud),
    Mesh,
}

#[allow(dead_code)] // Also used by the standalone benchmark and codec tests.
pub fn read<R: BufRead>(
    r: R,
    ext: &str,
    check: &mut impl FnMut(usize, usize) -> Result<()>,
) -> Result<Parsed> {
    read_budget(r, ext, usize::MAX, check)
}
pub fn read_budget<R: BufRead>(
    mut r: R,
    ext: &str,
    available: usize,
    check: &mut impl FnMut(usize, usize) -> Result<()>,
) -> Result<Parsed> {
    let mut header = 0;
    let mut comments = vec![];
    let mut fields = vec![];
    let n;
    let format;
    let mode;
    let mut editable = true;
    let mut warning = None;
    if ext == "pcd" {
        let mut h = std::collections::HashMap::<String, Vec<String>>::new();
        loop {
            let l = line(&mut r, &mut header)?;
            if l.starts_with('#') {
                comments.push(l);
                continue;
            }
            let mut words = l.split_whitespace();
            let Some(k) = words.next() else { continue };
            let vals = words.map(str::to_owned).collect::<Vec<_>>();
            if h.insert(k.to_string(), vals).is_some() {
                return Err("중복된 PCD 헤더".into());
            }
            if k == "DATA" {
                break;
            }
        }
        let get = |k: &str| h.get(k).ok_or_else(|| format!("PCD {k} 누락"));
        let one = |k: &str| -> Result<&str> {
            let v = get(k)?;
            if v.len() != 1 {
                return Err(format!("PCD {k} 값 오류"));
            }
            Ok(&v[0])
        };
        if !matches!(one("VERSION")?, ".7" | "0.7") {
            return Err("PCD v0.7만 지원합니다".into());
        }
        let names = get("FIELDS")?;
        let sizes = get("SIZE")?;
        let types = get("TYPE")?;
        let counts = h
            .get("COUNT")
            .cloned()
            .unwrap_or_else(|| vec!["1".into(); names.len()]);
        if names.len() != sizes.len() || names.len() != types.len() || names.len() != counts.len() {
            return Err("PCD 필드 개수 불일치".into());
        }
        for i in 0..names.len() {
            let scalar = match (types[i].as_str(), sizes[i].as_str()) {
                ("I", "1") => Scalar::I8,
                ("U", "1") => Scalar::U8,
                ("I", "2") => Scalar::I16,
                ("U", "2") => Scalar::U16,
                ("I", "4") => Scalar::I32,
                ("I", "8") => Scalar::I64,
                ("U", "8") => Scalar::U64,
                ("U", "4") => Scalar::U32,
                ("F", "4") => Scalar::F32,
                ("F", "8") => Scalar::F64,
                _ => return Err("지원하지 않는 PCD 타입".into()),
            };
            let c = count(&counts[i])?;
            if c == 0 {
                return Err("COUNT는 양수여야 합니다".into());
            }
            fields.push(Field {
                name: names[i].clone(),
                scalar,
                count: c,
                list: None,
            });
        }
        let width = count(one("WIDTH")?)?;
        let height = count(one("HEIGHT")?)?;
        n = count(one("POINTS")?)?;
        if width.checked_mul(height) != Some(n) || height == 0 {
            return Err("WIDTH/HEIGHT/POINTS 불일치".into());
        }
        let viewpoint = h
            .get("VIEWPOINT")
            .map(|v| v.join(" "))
            .unwrap_or_else(|| "0 0 0 1 0 0 0".into());
        let v: Vec<_> = viewpoint.split_whitespace().collect();
        if v.len() != 7
            || v.iter()
                .any(|s| s.parse::<f64>().map_or(true, |v| !v.is_finite()))
        {
            return Err("VIEWPOINT 오류".into());
        }
        format = Format::Pcd {
            width,
            height,
            viewpoint,
        };
        mode = one("DATA")?.to_owned();
    } else if ext == "ply" {
        if line(&mut r, &mut header)? != "ply" {
            return Err("PLY 헤더 오류".into());
        }
        let encoding = line(&mut r, &mut header)?;
        let words = encoding.split_whitespace().collect::<Vec<_>>();
        if words.len() != 3 || words[0] != "format" || words[2] != "1.0" {
            return Err("PLY 1.0 헤더 오류".into());
        }
        mode = words[1].to_string();
        format = Format::Ply;
        let mut vertex_count = None;
        let mut vertex = false;
        let mut any_before = false;
        loop {
            let l = line(&mut r, &mut header)?;
            let w = l.split_whitespace().collect::<Vec<_>>();
            match w.first().copied() {
                Some("end_header") => break,
                Some("comment" | "obj_info") => comments.push(l),
                Some("element") if w.len() == 3 => {
                    let c = count(w[2])?;
                    vertex = w[1] == "vertex";
                    if w[1] == "face" && c > 0 {
                        return Ok(Parsed::Mesh);
                    }
                    if vertex {
                        if vertex_count.is_some() || any_before {
                            return Err("vertex가 첫 요소여야 합니다".into());
                        }
                        vertex_count = Some(c);
                    } else if c > 0 {
                        if vertex_count.is_none() {
                            any_before = true;
                        }
                        editable = false;
                        warning = Some("점 외 PLY 요소가 있어 편집/저장을 제한합니다".into());
                    }
                }
                Some("property") if vertex => {
                    let f = if w.len() == 3 {
                        Field {
                            name: w[2].into(),
                            scalar: Scalar::from_ply(w[1])?,
                            count: 1,
                            list: None,
                        }
                    } else if w.len() == 5 && w[1] == "list" {
                        let list = Scalar::from_ply(w[2])?;
                        if matches!(list, Scalar::F32 | Scalar::F64) {
                            return Err("list 개수는 정수여야 합니다".into());
                        }
                        Field {
                            name: w[4].into(),
                            scalar: Scalar::from_ply(w[3])?,
                            count: 1,
                            list: Some(list),
                        }
                    } else {
                        return Err("PLY property 오류".into());
                    };
                    fields.push(f);
                }
                Some("property") => {}
                _ => return Err("PLY 헤더 항목 오류".into()),
            }
        }
        n = vertex_count.ok_or("PLY vertex 누락")?;
    } else {
        return Err("PCD/PLY만 지원합니다".into());
    }
    if n > MAX_POINTS {
        return Err("1천만 점 한도를 초과합니다".into());
    }
    if fields.is_empty() || fields.len() > 1024 {
        return Err("필드 개수 오류".into());
    }
    let mut unique = std::collections::HashSet::new();
    for f in &fields {
        if !unique.insert(&f.name) && f.name != "_" {
            return Err("중복된 필드 이름".into());
        }
    }
    for axis in ["x", "y", "z"] {
        if !fields
            .iter()
            .any(|f| f.name == axis && f.count == 1 && f.list.is_none())
        {
            return Err(format!("{axis} 좌표 누락"));
        }
    }
    let stride = fields.iter().try_fold(0usize, |s, f| {
        checked_size(f.count, f.scalar.size()).and_then(|v| {
            s.checked_add(v)
                .filter(|s| *s <= MAX_BYTES)
                .ok_or("레코드 크기 초과".into())
        })
    })?;
    let fixed = fields.iter().all(|f| f.list.is_none());
    let expected = checked_size(n, stride)?;
    // Includes the source positions, ID history, query index and two display copies.
    let remaining = available
        .checked_sub(n * 348)
        .ok_or("예상 작업 메모리 8GiB 한도를 초과합니다")?;
    let record_limit = MAX_BYTES.min(remaining / 3);
    if expected > record_limit {
        return Err("디코딩/작업 메모리 예산을 초과합니다".into());
    }
    let mut bytes = Vec::new();
    let mut offsets = Vec::with_capacity(n + 1);
    if mode == "binary_compressed" && matches!(format, Format::Pcd { .. }) {
        let mut lens = [0; 8];
        r.read_exact(&mut lens).map_err(|e| e.to_string())?;
        let packed = u32::from_le_bytes(lens[..4].try_into().unwrap()) as usize;
        let unpacked = u32::from_le_bytes(lens[4..].try_into().unwrap()) as usize;
        if packed
            .checked_add(unpacked)
            .and_then(|v| v.checked_add(expected))
            .is_none_or(|v| v > remaining)
        {
            return Err("압축 해제 메모리 예산을 초과합니다".into());
        }
        let dense_stride = fields
            .iter()
            .filter(|f| f.name != "_")
            .map(|f| f.count * f.scalar.size())
            .sum::<usize>();
        if unpacked != checked_size(n, dense_stride)? || packed > MAX_BYTES {
            return Err("압축 크기 불일치".into());
        }
        let mut input = vec![0; packed];
        r.read_exact(&mut input).map_err(|e| e.to_string())?;
        let planar = lzf(&input, unpacked, check)?;
        drop(input);
        bytes.resize(expected, 0);
        let mut src = 0;
        let mut offset = 0;
        for f in &fields {
            let size = f.count * f.scalar.size();
            if f.name != "_" {
                for i in 0..n {
                    if i % 16384 == 0 {
                        check(i, n)?;
                    }
                    bytes[i * stride + offset..i * stride + offset + size]
                        .copy_from_slice(&planar[src + i * size..src + (i + 1) * size]);
                }
                src += n * size;
            }
            offset += size;
        }
        offsets.extend((0..=n).map(|i| (i * stride) as u32));
    } else if (mode == "binary" || mode == "binary_little_endian") && fixed {
        bytes.resize(expected, 0);
        for (i, chunk) in bytes.chunks_mut(1 << 20).enumerate() {
            check(i * (1 << 20), expected)?;
            r.read_exact(chunk).map_err(|e| e.to_string())?;
        }
        offsets.extend((0..=n).map(|i| (i * stride) as u32));
    } else {
        let ascii = mode == "ascii";
        let big = mode == "binary_big_endian";
        if !ascii && !big && mode != "binary_little_endian" {
            return Err("지원하지 않는 인코딩".into());
        }
        bytes.reserve(expected);
        let mut token = Vec::new();
        for i in 0..n {
            if i % 16384 == 0 {
                check(i, n)?;
            }
            offsets.push(bytes.len() as u32);
            for f in &fields {
                let c = if let Some(t) = f.list {
                    let at = bytes.len();
                    read_scalar(&mut r, t, ascii, big, &mut token, &mut bytes)?;
                    let num = t.number(&bytes[at..]);
                    if num < 0. || num > MAX_BYTES as f64 {
                        return Err("list 개수 오류".into());
                    }
                    num as usize
                } else {
                    f.count
                };
                let extra = checked_size(c, f.scalar.size())?;
                if bytes
                    .len()
                    .checked_add(extra)
                    .is_none_or(|s| s > record_limit)
                {
                    return Err("디코딩 크기 초과".into());
                }
                for k in 0..c {
                    if k % 16384 == 0 {
                        check(i, n)?;
                    }
                    read_scalar(&mut r, f.scalar, ascii, big, &mut token, &mut bytes)?;
                }
            }
        }
        offsets.push(bytes.len() as u32);
    }
    let mut cloud = Cloud {
        format,
        fields,
        comments,
        bytes,
        offsets,
        positions: Vec::with_capacity(n),
        editable,
        warning,
    };
    for i in 0..n {
        if i % 16384 == 0 {
            check(i, n)?;
        }
        let mut p = [0.; 3];
        for (f, b) in cloud.values(i as u32) {
            match f.name.as_str() {
                "x" => p[0] = f.scalar.number(b),
                "y" => p[1] = f.scalar.number(b),
                "z" => p[2] = f.scalar.number(b),
                _ => {}
            }
        }
        cloud.positions.push(p);
    }
    check(n, n)?;
    Ok(Parsed::Cloud(cloud))
}

fn read_scalar<R: BufRead>(
    r: &mut R,
    t: Scalar,
    ascii: bool,
    big: bool,
    token: &mut Vec<u8>,
    out: &mut Vec<u8>,
) -> Result<()> {
    if ascii {
        token.clear();
        let mut whitespace = 0usize;
        loop {
            let b = r.fill_buf().map_err(|e| e.to_string())?;
            if b.is_empty() {
                break;
            }
            let mut used = 0;
            let mut done = false;
            for &c in b {
                used += 1;
                if c.is_ascii_whitespace() {
                    whitespace += 1;
                    if whitespace > 1024 * 1024 {
                        return Err("숫자 사이 공백이 1MiB를 초과합니다".into());
                    }
                    if !token.is_empty() {
                        done = true;
                        break;
                    }
                } else {
                    token.push(c);
                    if token.len() > 128 {
                        return Err("숫자 토큰이 너무 큽니다".into());
                    }
                }
            }
            r.consume(used);
            if done {
                break;
            }
        }
        let s = std::str::from_utf8(token).map_err(|_| "숫자가 UTF-8이 아닙니다")?;
        t.ascii(s, out)
    } else {
        let mut b = [0; 8];
        r.read_exact(&mut b[..t.size()])
            .map_err(|e| e.to_string())?;
        if big {
            b[..t.size()].reverse();
        }
        out.extend_from_slice(&b[..t.size()]);
        Ok(())
    }
}

fn lzf(
    input: &[u8],
    size: usize,
    check: &mut impl FnMut(usize, usize) -> Result<()>,
) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(size);
    let mut at = 0;
    let mut next = 0;
    while at < input.len() {
        if out.len() >= next {
            check(out.len(), size)?;
            next = out.len() + 65536;
        }
        let ctrl = input[at] as usize;
        at += 1;
        if ctrl < 32 {
            let len = ctrl + 1;
            if at + len > input.len() || out.len() + len > size {
                return Err("손상된 LZF literal".into());
            }
            out.extend_from_slice(&input[at..at + len]);
            at += len;
        } else {
            let mut len = ctrl >> 5;
            let mut distance = (ctrl & 31) << 8;
            if len == 7 {
                len += *input.get(at).ok_or("손상된 LZF 길이")? as usize;
                at += 1;
            }
            distance += *input.get(at).ok_or("손상된 LZF offset")? as usize + 1;
            at += 1;
            len += 2;
            if distance > out.len() || out.len() + len > size {
                return Err("손상된 LZF 참조".into());
            }
            for _ in 0..len {
                out.push(out[out.len() - distance]);
            }
        }
    }
    if out.len() != size {
        return Err("LZF 해제 크기 불일치".into());
    }
    Ok(out)
}

pub fn write<W: Write>(
    cloud: &Cloud,
    ids: &[u32],
    mut w: W,
    check: &mut impl FnMut(usize, usize) -> Result<()>,
) -> Result<()> {
    if !cloud.editable {
        return Err("이 파일의 추가 요소를 안전하게 저장할 수 없습니다".into());
    }
    let unchanged =
        ids.len() == cloud.len() && ids.iter().enumerate().all(|(i, &id)| i == id as usize);
    let io = |e: std::io::Error| e.to_string();
    match &cloud.format {
        Format::Pcd {
            width,
            height,
            viewpoint,
        } => {
            writeln!(w, "# .PCD v0.7\nVERSION 0.7").map_err(io)?;
            for c in &cloud.comments {
                writeln!(w, "{c}").map_err(io)?;
            }
            for key in ["FIELDS", "SIZE", "TYPE", "COUNT"] {
                write!(w, "{key}").map_err(io)?;
                for f in &cloud.fields {
                    let v = match key {
                        "FIELDS" => f.name.clone(),
                        "SIZE" => f.scalar.size().to_string(),
                        "COUNT" => f.count.to_string(),
                        _ => match f.scalar {
                            Scalar::F32 | Scalar::F64 => "F",
                            Scalar::I8 | Scalar::I16 | Scalar::I32 | Scalar::I64 => "I",
                            _ => "U",
                        }
                        .into(),
                    };
                    write!(w, " {v}").map_err(io)?;
                }
                writeln!(w).map_err(io)?;
            }
            let (width, height) = if unchanged {
                (*width, *height)
            } else {
                (ids.len(), 1)
            };
            writeln!(
                w,
                "WIDTH {width}\nHEIGHT {height}\nVIEWPOINT {viewpoint}\nPOINTS {}\nDATA binary",
                ids.len()
            )
            .map_err(io)?;
        }
        Format::Ply => {
            writeln!(w, "ply\nformat binary_little_endian 1.0").map_err(io)?;
            for c in &cloud.comments {
                writeln!(w, "{c}").map_err(io)?;
            }
            writeln!(w, "element vertex {}", ids.len()).map_err(io)?;
            for f in &cloud.fields {
                if let Some(t) = f.list {
                    writeln!(w, "property list {} {} {}", t.ply(), f.scalar.ply(), f.name)
                        .map_err(io)?;
                } else {
                    writeln!(w, "property {} {}", f.scalar.ply(), f.name).map_err(io)?;
                }
            }
            writeln!(w, "end_header").map_err(io)?;
        }
        Format::Las(_) => return Err("LAS/LAZ에는 전용 저장기가 필요합니다".into()),
    }
    for (i, &id) in ids.iter().enumerate() {
        if i % 16384 == 0 {
            check(i, ids.len())?;
        }
        if id as usize >= cloud.len() {
            return Err("점 ID 범위 오류".into());
        }
        w.write_all(cloud.record(id)).map_err(io)?;
    }
    check(ids.len(), ids.len())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn organized_invalid_and_empty_clouds_roundtrip() {
        let input = b"VERSION .7\nFIELDS x y z\nSIZE 8 8 8\nTYPE F F F\nWIDTH 1\nHEIGHT 2\nVIEWPOINT 1 2 3 1 0 0 0\nPOINTS 2\nDATA ascii\nnan inf -inf\n1 2 3\n";
        let c = parse(input, "pcd");
        let mut out = vec![];
        write(&c, &[0, 1], &mut out, &mut |_, _| Ok(())).unwrap();
        let d = parse(&out, "pcd");
        assert_eq!(d.bytes, c.bytes);
        assert!(matches!(
            d.format,
            Format::Pcd {
                width: 1,
                height: 2,
                ..
            }
        ));
        out.clear();
        write(&c, &[1], &mut out, &mut |_, _| Ok(())).unwrap();
        assert!(matches!(
            parse(&out, "pcd").format,
            Format::Pcd {
                width: 1,
                height: 1,
                ..
            }
        ));
        out.clear();
        write(&c, &[], &mut out, &mut |_, _| Ok(())).unwrap();
        assert_eq!(parse(&out, "pcd").len(), 0);
    }
    #[test]
    fn ply_nonpoint_elements_are_readonly_and_truncated_lists_fail() {
        let c = parse(b"ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nelement edge 1\nproperty int a\nend_header\n1 2 3\n0\n", "ply");
        assert!(!c.editable);
        assert!(c.warning.is_some());
        let bad = b"ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nproperty list uchar int descriptor\nend_header\n1 2 3 4 5 6\n";
        assert!(read(std::io::Cursor::new(bad), "ply", &mut |_, _| Ok(())).is_err());
    }
    #[test]
    fn uint64_attributes_do_not_round_through_f64() {
        let bytes=b"VERSION .7\nFIELDS x y z stamp\nSIZE 4 4 4 8\nTYPE F F F U\nWIDTH 1\nHEIGHT 1\nPOINTS 1\nDATA ascii\n1 2 3 18446744073709551615\n";
        let c = parse(bytes, "pcd");
        let (_, stamp) = c.values(0).last().unwrap();
        assert_eq!(Scalar::U64.text(stamp), "18446744073709551615");
        let mut out = vec![];
        write(&c, &[0], &mut out, &mut |_, _| Ok(())).unwrap();
        assert_eq!(parse(&out, "pcd").bytes, c.bytes);
    }
    #[test]
    fn budget_rejects_before_body_allocation() {
        let header = pcd_header("binary");
        assert!(
            matches!(read_budget(std::io::Cursor::new(header),"pcd",16,&mut|_,_|Ok(())),Err(e) if e.contains("메모리"))
        );
    }
    fn parse(b: &[u8], ext: &str) -> Cloud {
        match read(std::io::Cursor::new(b), ext, &mut |_, _| Ok(())).unwrap() {
            Parsed::Cloud(c) => c,
            _ => panic!("mesh"),
        }
    }
    fn pcd_header(mode: &str) -> String {
        format!(
            "VERSION .7\nFIELDS x y z ring desc\nSIZE 8 4 4 2 4\nTYPE F F F U F\nCOUNT 1 1 1 1 2\nWIDTH 2\nHEIGHT 1\nVIEWPOINT 1 2 3 1 0 0 0\nPOINTS 2\nDATA {mode}\n"
        )
    }
    #[test]
    fn pcd_roundtrip_preserves_custom_fields_and_f64() {
        let s = pcd_header("ascii") + "123456789.001 2 3 65535 1.25 2.5\n4 5 6 12 8 9\n";
        let c = parse(s.as_bytes(), "pcd");
        let mut b = vec![];
        write(&c, &[1, 0], &mut b, &mut |_, _| Ok(())).unwrap();
        let d = parse(&b, "pcd");
        assert_eq!(d.record(0), c.record(1));
        assert_eq!(d.record(1), c.record(0));
        assert_eq!(d.positions[1][0], 123456789.001);
    }
    #[test]
    fn ply_lists_and_big_endian_roundtrip() {
        let mut b=b"ply\nformat binary_big_endian 1.0\nelement vertex 1\nproperty double x\nproperty float y\nproperty float z\nproperty list uchar int labels\nend_header\n".to_vec();
        b.extend(1.5f64.to_be_bytes());
        b.extend(2f32.to_be_bytes());
        b.extend(3f32.to_be_bytes());
        b.push(2);
        b.extend((-7i32).to_be_bytes());
        b.extend(42i32.to_be_bytes());
        let c = parse(&b, "ply");
        let mut out = vec![];
        write(&c, &[0], &mut out, &mut |_, _| Ok(())).unwrap();
        let d = parse(&out, "ply");
        assert_eq!(c.bytes, d.bytes);
        assert_eq!(c.positions, vec![[1.5, 2., 3.]]);
    }
    #[test]
    fn malformed_and_limits_rejected() {
        for s in [
            pcd_header("ascii") + "1 2",
            pcd_header("ascii").replace("POINTS 2", "POINTS 10000001"),
            pcd_header("ascii").replace("COUNT 1 1 1 1 2", "COUNT 1 1 1 1 999999999999999999"),
        ] {
            assert!(read(std::io::Cursor::new(s), "pcd", &mut |_, _| Ok(())).is_err());
        }
    }
    #[test]
    fn compressed_is_field_major() {
        let header = "VERSION .7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nWIDTH 2\nHEIGHT 1\nPOINTS 2\nDATA binary_compressed\n";
        let mut data = vec![];
        for x in [1f32, 4., 2., 5., 3., 6.] {
            data.extend(x.to_le_bytes());
        }
        let mut b = header.as_bytes().to_vec();
        b.extend(25u32.to_le_bytes());
        b.extend(24u32.to_le_bytes());
        b.push(23);
        b.extend(data);
        let c = parse(&b, "pcd");
        assert_eq!(c.positions, vec![[1., 2., 3.], [4., 5., 6.]]);
    }
    #[test]
    fn lzf_rejects_bad_backrefs() {
        assert!(lzf(&[32, 0], 3, &mut |_, _| Ok(())).is_err());
        assert_eq!(
            lzf(&[0, b'a', 32, 0], 4, &mut |_, _| Ok(())).unwrap(),
            b"aaaa"
        );
    }
    #[test]
    fn cancellation_propagates() {
        assert!(
            read(
                std::io::Cursor::new(pcd_header("ascii") + "1 2 3 4 5 6\n1 2 3 4 5 6"),
                "pcd",
                &mut |_, _| Err("cancelled".into())
            )
            .is_err()
        );
    }
}
