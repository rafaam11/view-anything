use encoding_rs::EUC_KR;

#[tauri::command]
pub async fn decode_cp949(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.to_vec(),
        _ => return Err("raw bytes required".into()),
    };
    tauri::async_runtime::spawn_blocking(move || decode(&bytes)).await.map_err(|e| e.to_string())?
}

fn decode(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() > 10 * 1024 * 1024 { return Err("파일이 10 MiB를 초과합니다".into()); }
    let text = EUC_KR.decode_without_bom_handling_and_without_replacement(bytes)
        .ok_or("잘못된 CP949 파일입니다")?;
    if encode(&text)? != bytes { return Err("원문을 보존할 수 없는 CP949 파일입니다".into()); }
    Ok(text.into_owned())
}

fn encode(text: &str) -> Result<Vec<u8>, String> {
    if text.len() > 30 * 1024 * 1024 { return Err("텍스트가 너무 큽니다".into()); }
    let (bytes, _, errors) = EUC_KR.encode(text);
    if errors { return Err("CP949로 저장할 수 없는 문자가 있습니다. 편집 내용을 유지합니다".into()); }
    Ok(bytes.into_owned())
}

#[tauri::command]
pub async fn encode_cp949(text: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || encode(&text).map(tauri::ipc::Response::new))
        .await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn korean_and_extended_hangul_round_trip() {
        let text = "한글 뷁\r\nASCII";
        let bytes = encode(text).unwrap();
        assert_eq!(decode(&bytes).unwrap(), text);
        assert_eq!(encode("한글").unwrap(), vec![0xc7, 0xd1, 0xb1, 0xdb]);
    }
    #[test]
    fn rejects_invalid_bytes_and_unrepresentable_characters() {
        assert!(decode(&[0x81]).is_err());
        assert!(encode("한글 😀").is_err());
        assert!(decode(&vec![0; 10 * 1024 * 1024 + 1]).is_err());
    }
}
