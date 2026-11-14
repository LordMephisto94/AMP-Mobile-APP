//! The device's own key store, for the token vault: keys made inside Android's Keystore
//! (secure hardware where the phone has it) that never leave the phone. Elsewhere (tests,
//! desktops, Android before 12) `available()` is false and the vault uses the PIN alone.

use nsh_core::prelude::*;

#[native_module("ampmobile/native")]
fn native(registry: &mut Registry) {
    registry.module::<DeviceKey>();
}

/// Keys held by the device, used to seal the vault's data key.
#[module]
pub struct DeviceKey;

#[module]
impl DeviceKey {
    /// Whether this device can hold the vault's keys (Android 12 or newer).
    pub fn available() -> bool {
        #[cfg(target_os = "android")]
        {
            return android::vm().is_ok();
        }
        #[allow(unreachable_code)]
        false
    }

    /// Encrypts `data` (base64) with the key `alias`, making it on first use; returns the
    /// sealed text. `quick`: a key that works only within a minute of the phone being
    /// unlocked (fingerprint, face or the phone's PIN). Errors start with `auth:`, `invalid:`,
    /// `missing:` or `error:`.
    pub async fn seal(alias: String, data: String, quick: bool) -> Result<String, String> {
        #[cfg(target_os = "android")]
        {
            return android::seal(&alias, &data, quick);
        }
        #[allow(unreachable_code)]
        {
            let _ = (alias, data, quick);
            Err("error: no device key store".into())
        }
    }

    /// Decrypts what `seal` returned, back to base64.
    pub async fn open(alias: String, sealed: String) -> Result<String, String> {
        #[cfg(target_os = "android")]
        {
            return android::open(&alias, &sealed);
        }
        #[allow(unreachable_code)]
        {
            let _ = (alias, sealed);
            Err("error: no device key store".into())
        }
    }

    /// Deletes the key `alias` (nothing it sealed can be opened again).
    pub async fn forget(alias: String) -> bool {
        #[cfg(target_os = "android")]
        {
            return android::forget(&alias);
        }
        #[allow(unreachable_code)]
        {
            let _ = alias;
            false
        }
    }
}

#[cfg(target_os = "android")]
mod android {
    use jni::{
        objects::{JObject, JString, JValue},
        JNIEnv, JavaVM,
    };

    type GetVms = unsafe extern "system" fn(*mut *mut jni::sys::JavaVM, jni::sys::jsize, *mut jni::sys::jsize) -> jni::sys::jint;
    const BUILDER: &str = "android/security/keystore/KeyGenParameterSpec$Builder";
    const PROVIDER: &str = "AndroidKeyStore";
    const TRANSFORM: &str = "AES/GCM/NoPadding";

    /// The running Java VM: NSH keeps its own handle private, and Android 12+ lets any
    /// library ask for it.
    pub fn vm() -> Result<JavaVM, String> {
        unsafe {
            let mut sym = libc::dlsym(libc::RTLD_DEFAULT, c"JNI_GetCreatedJavaVMs".as_ptr());
            if sym.is_null() {
                let lib = libc::dlopen(c"libnativehelper.so".as_ptr(), libc::RTLD_NOW);
                if !lib.is_null() {
                    sym = libc::dlsym(lib, c"JNI_GetCreatedJavaVMs".as_ptr());
                }
            }
            if sym.is_null() {
                return Err("error: no Java VM on this Android version".into());
            }
            let get: GetVms = std::mem::transmute(sym);
            let mut raw: *mut jni::sys::JavaVM = std::ptr::null_mut();
            let mut count: jni::sys::jsize = 0;
            if get(&mut raw, 1, &mut count) != 0 || count < 1 {
                return Err("error: no Java VM".into());
            }
            JavaVM::from_raw(raw).map_err(|e| format!("error: {e}"))
        }
    }

    fn with_env<T>(work: impl FnOnce(&mut JNIEnv) -> Result<T, String>) -> Result<T, String> {
        let vm = vm()?;
        let mut env = vm.attach_current_thread().map_err(|e| format!("error: {e}"))?;
        work(&mut env)
    }

    /// A Java exception as one of the error kinds above.
    fn classify(env: &mut JNIEnv, err: jni::errors::Error) -> String {
        if env.exception_check().unwrap_or(false) {
            let ex = env.exception_occurred().ok();
            let _ = env.exception_clear();
            if let Some(ex) = ex {
                let text = env
                    .call_method(&ex, "toString", "()Ljava/lang/String;", &[])
                    .and_then(|v| v.l())
                    .ok()
                    .and_then(|s| env.get_string(&JString::from(s)).ok().map(String::from))
                    .unwrap_or_default();
                let _ = env.exception_clear();
                return if text.contains("UserNotAuthenticated") {
                    format!("auth: {text}")
                } else if text.contains("KeyPermanentlyInvalidated") {
                    format!("invalid: {text}")
                } else {
                    format!("error: {text}")
                };
            }
        }
        format!("error: {err}")
    }

    fn keystore<'a>(env: &mut JNIEnv<'a>) -> jni::errors::Result<JObject<'a>> {
        let provider = env.new_string(PROVIDER)?;
        let ks = env
            .call_static_method("java/security/KeyStore", "getInstance", "(Ljava/lang/String;)Ljava/security/KeyStore;", &[JValue::Object(&provider)])?
            .l()?;
        env.call_method(&ks, "load", "(Ljava/security/KeyStore$LoadStoreParameter;)V", &[JValue::Object(&JObject::null())])?;
        Ok(ks)
    }

    fn get_key<'a>(env: &mut JNIEnv<'a>, alias: &str) -> jni::errors::Result<JObject<'a>> {
        let ks = keystore(env)?;
        let name = env.new_string(alias)?;
        env.call_method(&ks, "getKey", "(Ljava/lang/String;[C)Ljava/security/Key;", &[JValue::Object(&name), JValue::Object(&JObject::null())])?
            .l()
    }

    fn make_key<'a>(env: &mut JNIEnv<'a>, alias: &str, quick: bool) -> jni::errors::Result<JObject<'a>> {
        let name = env.new_string(alias)?;
        let aes = env.new_string("AES")?;
        let provider = env.new_string(PROVIDER)?;
        let generator = env
            .call_static_method(
                "javax/crypto/KeyGenerator",
                "getInstance",
                "(Ljava/lang/String;Ljava/lang/String;)Ljavax/crypto/KeyGenerator;",
                &[JValue::Object(&aes), JValue::Object(&provider)],
            )?
            .l()?;
        // PURPOSE_ENCRYPT | PURPOSE_DECRYPT
        let builder = env.new_object(BUILDER, "(Ljava/lang/String;I)V", &[JValue::Object(&name), JValue::Int(3)])?;
        let ret = format!("L{BUILDER};");
        let strings = format!("([Ljava/lang/String;){ret}");
        let gcm = env.new_string("GCM")?;
        let modes = env.new_object_array(1, "java/lang/String", &gcm)?;
        env.call_method(&builder, "setBlockModes", &strings, &[JValue::Object(&modes)])?;
        let none = env.new_string("NoPadding")?;
        let pads = env.new_object_array(1, "java/lang/String", &none)?;
        env.call_method(&builder, "setEncryptionPaddings", &strings, &[JValue::Object(&pads)])?;
        env.call_method(&builder, "setKeySize", format!("(I){ret}"), &[JValue::Int(256)])?;
        if quick {
            env.call_method(&builder, "setUserAuthenticationRequired", format!("(Z){ret}"), &[JValue::Bool(1)])?;
            // 60 s after the phone was unlocked with a strong biometric (1) or its own PIN (2).
            env.call_method(&builder, "setUserAuthenticationParameters", format!("(II){ret}"), &[JValue::Int(60), JValue::Int(3)])?;
        }
        let spec = env.call_method(&builder, "build", "()Landroid/security/keystore/KeyGenParameterSpec;", &[])?.l()?;
        env.call_method(&generator, "init", "(Ljava/security/spec/AlgorithmParameterSpec;)V", &[JValue::Object(&spec)])?;
        env.call_method(&generator, "generateKey", "()Ljavax/crypto/SecretKey;", &[])?.l()
    }

    fn b64_decode<'a>(env: &mut JNIEnv<'a>, text: &str) -> jni::errors::Result<JObject<'a>> {
        let decoder = env.call_static_method("java/util/Base64", "getDecoder", "()Ljava/util/Base64$Decoder;", &[])?.l()?;
        let s = env.new_string(text)?;
        env.call_method(&decoder, "decode", "(Ljava/lang/String;)[B", &[JValue::Object(&s)])?.l()
    }

    fn b64_encode(env: &mut JNIEnv, bytes: &JObject) -> jni::errors::Result<String> {
        let encoder = env.call_static_method("java/util/Base64", "getEncoder", "()Ljava/util/Base64$Encoder;", &[])?.l()?;
        let s = env.call_method(&encoder, "encodeToString", "([B)Ljava/lang/String;", &[JValue::Object(bytes)])?.l()?;
        Ok(env.get_string(&JString::from(s))?.into())
    }

    fn cipher<'a>(env: &mut JNIEnv<'a>) -> jni::errors::Result<JObject<'a>> {
        let t = env.new_string(TRANSFORM)?;
        env.call_static_method("javax/crypto/Cipher", "getInstance", "(Ljava/lang/String;)Ljavax/crypto/Cipher;", &[JValue::Object(&t)])?
            .l()
    }

    pub fn seal(alias: &str, data: &str, quick: bool) -> Result<String, String> {
        with_env(|env| {
            let run = |env: &mut JNIEnv| -> jni::errors::Result<String> {
                let mut key = get_key(env, alias)?;
                if key.is_null() {
                    key = make_key(env, alias, quick)?;
                }
                let c = cipher(env)?;
                env.call_method(&c, "init", "(ILjava/security/Key;)V", &[JValue::Int(1), JValue::Object(&key)])?;
                let iv = env.call_method(&c, "getIV", "()[B", &[])?.l()?;
                let plain = b64_decode(env, data)?;
                let ct = env.call_method(&c, "doFinal", "([B)[B", &[JValue::Object(&plain)])?.l()?;
                Ok(format!("{}:{}", b64_encode(env, &iv)?, b64_encode(env, &ct)?))
            };
            run(env).map_err(|e| classify(env, e))
        })
    }

    pub fn open(alias: &str, sealed: &str) -> Result<String, String> {
        let (iv, ct) = sealed.split_once(':').ok_or_else(|| "error: not a sealed value".to_string())?;
        with_env(|env| {
            let run = |env: &mut JNIEnv| -> jni::errors::Result<Option<String>> {
                let key = get_key(env, alias)?;
                if key.is_null() {
                    return Ok(None);
                }
                let iv = b64_decode(env, iv)?;
                let ct = b64_decode(env, ct)?;
                let spec = env.new_object("javax/crypto/spec/GCMParameterSpec", "(I[B)V", &[JValue::Int(128), JValue::Object(&iv)])?;
                let c = cipher(env)?;
                env.call_method(
                    &c,
                    "init",
                    "(ILjava/security/Key;Ljava/security/spec/AlgorithmParameterSpec;)V",
                    &[JValue::Int(2), JValue::Object(&key), JValue::Object(&spec)],
                )?;
                let plain = env.call_method(&c, "doFinal", "([B)[B", &[JValue::Object(&ct)])?.l()?;
                Ok(Some(b64_encode(env, &plain)?))
            };
            match run(env) {
                Ok(Some(text)) => Ok(text),
                Ok(None) => Err("missing: no such key".into()),
                Err(e) => Err(classify(env, e)),
            }
        })
    }

    pub fn forget(alias: &str) -> bool {
        with_env(|env| {
            let run = |env: &mut JNIEnv| -> jni::errors::Result<()> {
                let ks = keystore(env)?;
                let name = env.new_string(alias)?;
                env.call_method(&ks, "deleteEntry", "(Ljava/lang/String;)V", &[JValue::Object(&name)])?;
                Ok(())
            };
            run(env).map_err(|e| classify(env, e))
        })
        .is_ok()
    }
}
