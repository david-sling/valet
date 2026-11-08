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

// Windows Hello shows its dialog over this window, so it can't open behind Valet
#[cfg(windows)]
static WINDOW: std::sync::OnceLock<isize> = std::sync::OnceLock::new();

#[cfg(windows)]
pub fn set_window(hwnd: isize) {
    let _ = WINDOW.set(hwnd);
}

#[cfg(windows)]
pub async fn confirm(reason: &str) -> Result<(), String> {
    use windows::core::{factory, HSTRING};
    use windows::Security::Credentials::UI::{UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::IUserConsentVerifierInterop;
    use windows_future::IAsyncOperation;

    let reason = HSTRING::from(reason);
    let hwnd = WINDOW.get().copied().unwrap_or_default();
    let result = tokio::task::spawn_blocking(move || -> Result<UserConsentVerificationResult, String> {
        let available = UserConsentVerifier::CheckAvailabilityAsync().and_then(|op| op.join()).map_err(|e| e.message())?;
        if available != UserConsentVerifierAvailability::Available {
            return Err(match available {
                UserConsentVerifierAvailability::DeviceNotPresent | UserConsentVerifierAvailability::NotConfiguredForUser => {
                    "Set up Windows Hello (a PIN, fingerprint or face) in Settings to approve high-risk requests.".into()
                }
                UserConsentVerifierAvailability::DisabledByPolicy => "Windows Hello is turned off by your organisation's policy.".into(),
                _ => "Windows Hello is busy. Try again.".into(),
            });
        }
        let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>().map_err(|e| e.message())?;
        let op: IAsyncOperation<UserConsentVerificationResult> =
            unsafe { interop.RequestVerificationForWindowAsync(HWND(hwnd as _), &reason) }.map_err(|e| e.message())?;
        op.join().map_err(|e| e.message())
    })
    .await
    .map_err(|e| e.to_string())??;
    match result {
        UserConsentVerificationResult::Verified => Ok(()),
        UserConsentVerificationResult::Canceled => Err("Not confirmed.".into()),
        UserConsentVerificationResult::RetriesExhausted => Err("Too many tries. Windows Hello is locked for now.".into()),
        _ => Err("Windows Hello couldn't confirm it's you.".into()),
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
pub async fn confirm(_reason: &str) -> Result<(), String> {
    Err("Confirming high-risk requests needs Touch ID or Windows Hello.".into())
}

// What the record says the person confirmed with
pub const METHOD: &str = if cfg!(windows) { "windows_hello" } else { "touch_id" };
