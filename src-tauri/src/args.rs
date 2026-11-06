use std::path::PathBuf;

/// What a command line asks for: a file (or none) and whether to show it as text.
#[derive(Debug, PartialEq)]
pub struct Launch {
    pub path: Option<PathBuf>,
    pub text: bool,
}

/// `view-anything [--text] [--] <path | file:// URI>`. Unknown flags are ignored; everything after
/// `--` is a path. Linux file managers may pass `file://` URIs, which are decoded to paths.
pub fn parse_launch(args: &[String]) -> Launch {
    let mut launch = Launch { path: None, text: false };
    let mut flags = true;
    for arg in args.iter().skip(1) {
        if arg.is_empty() {
            continue;
        }
        if flags && arg == "--" {
            flags = false;
        } else if flags && arg == "--text" {
            launch.text = true;
        } else if flags && arg.starts_with('-') {
            // Not ours (or a future flag): ignored rather than taken as a file name.
        } else if launch.path.is_none() {
            launch.path = Some(path_of(arg));
        }
    }
    launch
}

fn path_of(arg: &str) -> PathBuf {
    let Some(rest) = arg.strip_prefix("file://") else { return PathBuf::from(arg) };
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
    let decoded = percent_encoding::percent_decode_str(rest).decode_utf8_lossy();
    // file:///C:/x -> C:/x (a drive letter after the authority's empty host).
    let bytes = decoded.as_bytes();
    if bytes.len() >= 3 && bytes[0] == b'/' && bytes[1].is_ascii_alphabetic() && bytes[2] == b':' {
        PathBuf::from(&decoded[1..])
    } else {
        PathBuf::from(decoded.as_ref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file_arg(args: &[String]) -> Option<PathBuf> {
        parse_launch(args).path
    }

    #[test]
    fn picks_first_non_flag_arg() {
        assert_eq!(
            file_arg(&["va.exe".into(), "D:\\문서 폴더\\a b.md".into()]),
            Some(PathBuf::from("D:\\문서 폴더\\a b.md"))
        );
    }

    #[test]
    fn ignores_flags_and_empty() {
        assert_eq!(file_arg(&["va.exe".into(), "--flag".into()]), None);
        assert_eq!(file_arg(&["va.exe".into()]), None);
    }

    #[test]
    fn text_flag_and_double_dash() {
        let l = parse_launch(&["va".into(), "--text".into(), "D:\\문서 폴더\\a b.xyz".into()]);
        assert!(l.text);
        assert_eq!(l.path, Some(PathBuf::from("D:\\문서 폴더\\a b.xyz")));
        let l = parse_launch(&["va".into(), "D:\\a.log".into(), "--text".into()]);
        assert!(l.text);
        assert_eq!(l.path, Some(PathBuf::from("D:\\a.log")));
        let l = parse_launch(&["va".into(), "--".into(), "--weird.md".into()]);
        assert_eq!(l.path, Some(PathBuf::from("--weird.md")));
        assert!(!l.text);
        let l = parse_launch(&["va".into(), "--text".into()]);
        assert_eq!(l, Launch { path: None, text: true });
    }

    #[test]
    fn file_uris_are_decoded() {
        let l = parse_launch(&["va".into(), "file:///home/u/%ED%95%9C%20a.md".into()]);
        assert_eq!(l.path, Some(PathBuf::from("/home/u/한 a.md")));
        let l = parse_launch(&["va".into(), "file:///C:/x/y.md".into()]);
        assert_eq!(l.path, Some(PathBuf::from("C:/x/y.md")));
        let l = parse_launch(&["va".into(), "file://localhost/tmp/z.md".into()]);
        assert_eq!(l.path, Some(PathBuf::from("/tmp/z.md")));
        assert_eq!(file_arg(&["va".into(), "file:///tmp/q.md".into()]), Some(PathBuf::from("/tmp/q.md")));
    }
}
