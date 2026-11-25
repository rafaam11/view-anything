/** Text-only routing: no editor or renderer dependencies in the entry bundle. */
export const TEXT_EXTENSIONS = ["txt", "log", "ini", "cfg", "conf", "toml", "xml", "html", "htm", "css", "scss", "c", "h", "cc", "cpp", "cxx", "hpp", "py", "rs", "js", "jsx", "ts", "tsx", "sh", "bash", "ps1", "bat", "cmd", "sql", "java", "cs", "go", "rb", "lua"];
/**
 * Text the shell can run: double-clicking them must keep running them. The installer never
 * associates these (not even under Open With, which makes Windows 11 ask which app to use); it
 * offers a right-click "View Anything으로 보기" verb instead (src-tauri/windows/file-associations.nsh).
 */
export const SCRIPT_EXTENSIONS = ["bat", "cmd", "ps1", "js", "py", "sh", "bash"];
