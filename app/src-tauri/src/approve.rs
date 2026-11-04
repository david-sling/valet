#[cfg(target_os = "macos")]
pub async fn confirm(reason: &str) -> Result<(), String> {
    use std::sync::Mutex;

    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let tx = Mutex::new(Some(tx));
    {
        let context = unsafe { LAContext::new() };
        let reason = NSString::from_str(reason);
        let reply = RcBlock::new(move |ok: Bool, error: *mut NSError| {
            let result = if ok.as_bool() {
                Ok(())
            } else if error.is_null() {
                Err("Not confirmed.".to_string())
            } else {
                Err(unsafe { (*error).localizedDescription() }.to_string())
            };
            if let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) {
                let _ = tx.send(result);
            }
        });
        unsafe { context.evaluatePolicy_localizedReason_reply(LAPolicy::DeviceOwnerAuthentication, &reason, &reply) };
    }
    rx.await.unwrap_or_else(|_| Err("Not confirmed.".into()))
}

#[cfg(not(target_os = "macos"))]
pub async fn confirm(_reason: &str) -> Result<(), String> {
    Err("Confirming with Touch ID needs macOS.".into())
}
