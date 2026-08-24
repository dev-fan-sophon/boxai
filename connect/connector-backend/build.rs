use std::{env, fs, path::Path};

/// The updater's trust anchor is declared once, in the release metadata the
/// publisher also reads, and compiled in from there. A key that only lived in
/// Rust source could drift from the key the publisher signs with, and the
/// mismatch would not show up until an update failed on someone's machine.
fn main() {
    const METADATA_PATH: &str = "../release-metadata.json";
    println!("cargo:rerun-if-changed={METADATA_PATH}");

    let metadata: serde_json::Value =
        serde_json::from_slice(&fs::read(METADATA_PATH).expect("read BoxAI release metadata"))
            .expect("parse BoxAI release metadata");
    let hex = metadata
        .get("update_public_key")
        .and_then(serde_json::Value::as_str)
        .expect("release metadata must carry update_public_key");
    assert_eq!(
        hex.len(),
        64,
        "update_public_key must be 32 hex-encoded bytes"
    );
    let bytes: Vec<String> = (0..32)
        .map(|index| {
            let byte = u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16)
                .expect("update_public_key must be hexadecimal");
            format!("0x{byte:02x}")
        })
        .collect();

    let out = Path::new(&env::var("OUT_DIR").expect("OUT_DIR")).join("update_public_key.rs");
    fs::write(
        out,
        format!(
            "pub const CONNECTOR_UPDATE_PUBLIC_KEY: [u8; 32] = [{}];\n",
            bytes.join(", ")
        ),
    )
    .expect("write the compiled update public key");
}
