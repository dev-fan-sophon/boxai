fn main() {
    println!("cargo:rerun-if-changed=../packaging/icons/boxai-connector.ico");
    #[cfg(windows)]
    winresource::WindowsResource::new()
        .set_icon("../packaging/icons/boxai-connector.ico")
        .set("ProductName", "BoxAI Connector")
        .set("FileDescription", "BoxAI Gateway Connector")
        .set("InternalName", "boxai-connector")
        .set("OriginalFilename", "boxai-connector.exe")
        .compile()
        .expect("compile BoxAI Connector Windows resources");
}
