use std::path::PathBuf;

/// Returns the first non-flag argument (skipping argv[0]) as a path.
pub fn file_arg(args: &[String]) -> Option<PathBuf> {
    args.iter()
        .skip(1)
        .find(|a| !a.is_empty() && !a.starts_with('-'))
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
