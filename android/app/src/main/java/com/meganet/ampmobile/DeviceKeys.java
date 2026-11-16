package com.meganet.ampmobile;

import android.app.Activity;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.CancellationSignal;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.security.keystore.UserNotAuthenticatedException;
import com.longbridge.nsh.NshHostReply;
import com.longbridge.nsh.NshView;
import java.security.KeyStore;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/**
 * The phone's key store, for the app's token vault, answered over NSH's host channel
 * (`host.call("deviceKey.…")` in the TSX app). Keys are AES-256-GCM, made inside Android's
 * Keystore (secure hardware where the phone has it), and never leave it.
 *
 * Three kinds of key:
 *   bound      works without the user; it ties the PIN-sealed vault to this phone.
 *   quick      works within a minute of the phone being unlocked.
 *   biometric  works once per fingerprint or face check (strong biometrics only), and is
 *              voided when a fingerprint or face is added to the phone.
 *
 * Sealed text is "iv:ciphertext" in base64, the format the earlier Rust module wrote, under
 * the same aliases, so vaults sealed by earlier versions still open.
 *
 * Errors start with a kind the app tells apart: "auth:" (the quick key's minute has passed),
 * "invalid:" (the key was voided), "missing:" (no such key), "cancel:" (the user closed the
 * prompt), "lockout:" (too many tries), "unavailable:" (no strong biometrics), "busy:"
 * (another prompt is open) or "error:".
 */
final class DeviceKeys {
    private static final String PROVIDER = "AndroidKeyStore";
    private static final String TRANSFORM = "AES/GCM/NoPadding";
    private static final int TAG_BITS = 128;

    private final Activity activity;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    /** The open prompt, if any: one at a time. Touched on the UI thread only. */
    private CancellationSignal prompting;

    DeviceKeys(Activity activity) {
        this.activity = activity;
    }

    void register(NshView view) {
        view.handle("deviceKey.status", (data, reply) -> reply.resolve(status()));
        view.handle("deviceKey.seal", (data, reply) -> seal(args(data), reply));
        view.handle("deviceKey.open", (data, reply) -> open(args(data), reply));
        view.handle("deviceKey.mac", (data, reply) -> mac(args(data), reply));
        view.handle("deviceKey.forget", (data, reply) -> {
            String alias = text(args(data), "alias");
            work(reply::reject, () -> reply.resolve(forget(alias)));
        });
    }

    void close() {
        if (prompting != null) prompting.cancel();
        prompting = null;
        worker.shutdown();
    }

    /** Runs `task` on the key store's thread; once the screen has closed, answers `refuse` instead. */
    private void work(java.util.function.Consumer<String> refuse, Runnable task) {
        try {
            worker.execute(task);
        } catch (java.util.concurrent.RejectedExecutionException e) {
            refuse.accept("cancel: the app closed");
        }
    }

        // What the phone can do.

    private Map<String, Object> status() {
        Map<String, Object> s = new HashMap<>();
        s.put("keys", true);
        s.put("biometric", biometricState());
        s.put("mac", true);
        return s;
    }

    /** "ready", "notEnrolled" (strong biometrics, none set up) or "unavailable". */
    private String biometricState() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return "unavailable";
        BiometricManager manager = activity.getSystemService(BiometricManager.class);
        if (manager == null) return "unavailable";
        int can = manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        if (can == BiometricManager.BIOMETRIC_SUCCESS) return "ready";
        if (can == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) return "notEnrolled";
        return "unavailable";
    }

    // seal / open / forget

    private void seal(Map<String, Object> a, NshHostReply reply) {
        String alias = text(a, "alias");
        String data = text(a, "data");
        String kind = text(a, "kind");
        if (alias == null || data == null || kind == null) {
            reply.reject("error: alias, data and kind are needed");
            return;
        }
        work(reply::reject, () -> {
            try {
                Cipher cipher = encryptor(alias, kind);
                byte[] plain = Base64.getDecoder().decode(data);
                if (!"biometric".equals(kind)) {
                    reply.resolve(sealed(cipher.getIV(), cipher.doFinal(plain)));
                    return;
                }
                activity.runOnUiThread(() -> prompt(cipher, prompt(a), reply, done -> sealed(done.getIV(), done.doFinal(plain))));
            } catch (Exception e) {
                reply.reject(classify(e));
            }
        });
    }

    private void open(Map<String, Object> a, NshHostReply reply) {
        String alias = text(a, "alias");
        String sealedText = text(a, "sealed");
        int colon = sealedText == null ? -1 : sealedText.indexOf(':');
        if (alias == null || colon < 0) {
            reply.reject("error: not a sealed value");
            return;
        }
        work(reply::reject, () -> {
            try {
                SecretKey key = key(alias);
                if (key == null) {
                    reply.reject("missing: no such key");
                    return;
                }
                byte[] iv = Base64.getDecoder().decode(sealedText.substring(0, colon));
                byte[] ct = Base64.getDecoder().decode(sealedText.substring(colon + 1));
                Cipher cipher = Cipher.getInstance(TRANSFORM);
                cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
                if (!needsPrompt(a)) {
                    reply.resolve(Base64.getEncoder().encodeToString(cipher.doFinal(ct)));
                    return;
                }
                activity.runOnUiThread(() -> prompt(cipher, prompt(a), reply, done -> Base64.getEncoder().encodeToString(done.doFinal(ct))));
            } catch (Exception e) {
                reply.reject(classify(e));
            }
        });
    }

    /**
     * HMAC-SHA-256 of `data` (base64) under the key `alias`, which never leaves the phone. The vault
     * mixes it into the PIN's key, so a PIN guess can only be checked here. With `create` a missing
     * key is made; without it a missing key is an error, so a lost key is never quietly replaced.
     */
    private void mac(Map<String, Object> a, NshHostReply reply) {
        String alias = text(a, "alias");
        String data = text(a, "data");
        boolean create = Boolean.TRUE.equals(a.get("create"));
        if (alias == null || data == null) {
            reply.reject("error: alias and data are needed");
            return;
        }
        work(reply::reject, () -> {
            try {
                SecretKey key = key(alias);
                if (key == null) {
                    if (!create) {
                        reply.reject("missing: no such key");
                        return;
                    }
                    key = makeMacKey(alias);
                }
                Mac hmac = Mac.getInstance("HmacSHA256");
                hmac.init(key);
                reply.resolve(Base64.getEncoder().encodeToString(hmac.doFinal(Base64.getDecoder().decode(data))));
            } catch (Exception e) {
                reply.reject(classify(e));
            }
        });
    }

    /** An HMAC key in the key store: in StrongBox where the phone has it, else a plain one. */
    private static SecretKey makeMacKey(String alias) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                return generateMacKey(alias, true);
            } catch (Exception hardwareRefused) {
                // No StrongBox: the plain key below still never leaves the key store.
            }
        }
        return generateMacKey(alias, false);
    }

    private static SecretKey generateMacKey(String alias, boolean hardened) throws Exception {
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN).setDigests(KeyProperties.DIGEST_SHA256);
        // StrongBox only: "unlocked device required" was left off, since a key with it may be voided when the
        // phone's screen lock is removed, and losing this key loses every saved sign-in.
        if (hardened) b.setIsStrongBoxBacked(true);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, PROVIDER);
        generator.init(b.build());
        return generator.generateKey();
    }

    private boolean forget(String alias) {
        if (alias == null) return false;
        try {
            keystore().deleteEntry(alias);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    // Keys

    private static KeyStore keystore() throws Exception {
        KeyStore ks = KeyStore.getInstance(PROVIDER);
        ks.load(null);
        return ks;
    }

    private static SecretKey key(String alias) throws Exception {
        return (SecretKey) keystore().getKey(alias, null);
    }

    /** A cipher ready to encrypt with `alias`, making the key on first use. */
    private static Cipher encryptor(String alias, String kind) throws Exception {
        SecretKey key = key(alias);
        if (key == null) key = makeKey(alias, kind);
        Cipher cipher = Cipher.getInstance(TRANSFORM);
        try {
            cipher.init(Cipher.ENCRYPT_MODE, key);
        } catch (KeyPermanentlyInvalidatedException e) {
            // Voided (a fingerprint was added, the screen lock removed): a fresh key for a fresh seal.
            keystore().deleteEntry(alias);
            cipher.init(Cipher.ENCRYPT_MODE, makeKey(alias, kind));
        }
        return cipher;
    }

    private static SecretKey makeKey(String alias, String kind) throws Exception {
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256);
        switch (kind) {
            case "bound":
                break;
            case "quick":
                b.setUserAuthenticationRequired(true);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    b.setUserAuthenticationParameters(60, KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL);
                } else {
                    legacyValidity(b, 60);
                }
                break;
            case "biometric":
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) throw new IllegalStateException("unavailable: needs Android 11");
                b.setUserAuthenticationRequired(true)
                        .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
                        .setInvalidatedByBiometricEnrollment(true);
                break;
            default:
                throw new IllegalArgumentException("error: unknown key kind " + kind);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER);
        generator.init(b.build());
        return generator.generateKey();
    }

    @SuppressWarnings("deprecation")
    private static void legacyValidity(KeyGenParameterSpec.Builder b, int seconds) {
        b.setUserAuthenticationValidityDurationSeconds(seconds);
    }

    // The prompt

    private interface Finish {
        String run(Cipher cipher) throws Exception;
    }

    private static final class PromptText {
        String title = "Unlock AMP Mobile";
        String subtitle = null;
        String cancel = "Use PIN";
    }

    /** Shows the fingerprint / face prompt for `cipher`, then finishes with the unlocked cipher. UI thread. */
    private void prompt(Cipher cipher, PromptText text, NshHostReply first, Finish finish) {
        // The negative button and onAuthenticationError can both fire: the app gets one answer.
        Once reply = new Once(first);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            reply.reject("unavailable: needs Android 11");
            return;
        }
        if (prompting != null) {
            reply.reject("busy: a prompt is already open");
            return;
        }
        if (activity.isFinishing() || activity.isDestroyed()) {
            reply.reject("cancel: the app closed");
            return;
        }
        CancellationSignal signal = new CancellationSignal();
        prompting = signal;
        BiometricPrompt.Builder builder = new BiometricPrompt.Builder(activity)
                .setTitle(text.title)
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .setConfirmationRequired(false)
                .setNegativeButton(text.cancel, activity.getMainExecutor(), (dialog, which) -> {
                    // onAuthenticationError(ERROR_NEGATIVE_BUTTON) does not follow on every phone.
                    if (prompting == signal) prompting = null;
                    reply.reject("cancel: use the PIN");
                });
        if (text.subtitle != null) builder.setSubtitle(text.subtitle);
        try {
            builder.build().authenticate(new BiometricPrompt.CryptoObject(cipher), signal, activity.getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    if (prompting == signal) prompting = null;
                    Cipher unlocked = result.getCryptoObject() != null ? result.getCryptoObject().getCipher() : cipher;
                    work(reply::reject, () -> {
                        try {
                            reply.resolve(finish.run(unlocked));
                        } catch (Exception e) {
                            reply.reject(classify(e));
                        }
                    });
                }

                @Override
                public void onAuthenticationError(int code, CharSequence message) {
                    if (prompting == signal) prompting = null;
                    reply.reject(promptError(code) + message);
                }
                // onAuthenticationFailed: one finger that didn't match; the prompt stays and says so.
            });
        } catch (Exception e) {
            if (prompting == signal) prompting = null;
            reply.reject(classify(e));
        }
    }

    private static String promptError(int code) {
        switch (code) {
            case BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED:
            case BiometricPrompt.BIOMETRIC_ERROR_CANCELED:
                return "cancel: ";
            case BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT:
            case BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT_PERMANENT:
                return "lockout: ";
            case BiometricPrompt.BIOMETRIC_ERROR_NO_BIOMETRICS:
            case BiometricPrompt.BIOMETRIC_ERROR_HW_NOT_PRESENT:
            case BiometricPrompt.BIOMETRIC_ERROR_HW_UNAVAILABLE:
                return "unavailable: ";
            default:
                return "error: ";
        }
    }

    // Helpers

    /** A reply that takes the first answer and drops the rest. */
    private static final class Once {
        private final NshHostReply reply;
        private final java.util.concurrent.atomic.AtomicBoolean answered = new java.util.concurrent.atomic.AtomicBoolean();

        Once(NshHostReply reply) {
            this.reply = reply;
        }

        void resolve(Object value) {
            if (answered.compareAndSet(false, true)) reply.resolve(value);
        }

        void reject(String message) {
            if (answered.compareAndSet(false, true)) reply.reject(message);
        }
    }

    private static String sealed(byte[] iv, byte[] ct) {
        return Base64.getEncoder().encodeToString(iv) + ":" + Base64.getEncoder().encodeToString(ct);
    }

    /** An exception as one of the error kinds above. */
    private static String classify(Exception e) {
        Throwable t = e;
        while (t != null) {
            if (t instanceof UserNotAuthenticatedException) return "auth: " + t;
            if (t instanceof KeyPermanentlyInvalidatedException) return "invalid: " + t;
            String m = t.getMessage();
            if (m != null && m.matches("^(auth|invalid|missing|cancel|lockout|unavailable|busy|error):.*")) return m;
            t = t.getCause();
        }
        return "error: " + e;
    }

    private static boolean needsPrompt(Map<String, Object> a) {
        Object p = a.get("prompt");
        return p != null && !JSONObject.NULL.equals(p);
    }

    private static PromptText prompt(Map<String, Object> a) {
        PromptText p = new PromptText();
        Map<String, Object> m = map(a.get("prompt"));
        if (text(m, "title") != null) p.title = text(m, "title");
        if (text(m, "subtitle") != null) p.subtitle = text(m, "subtitle");
        if (text(m, "cancel") != null) p.cancel = text(m, "cancel");
        return p;
    }

    private static Map<String, Object> args(Object data) {
        return map(data);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object data) {
        if (data instanceof Map) return (Map<String, Object>) data;
        Map<String, Object> out = new HashMap<>();
        if (data instanceof JSONObject) {
            JSONObject o = (JSONObject) data;
            for (java.util.Iterator<String> it = o.keys(); it.hasNext(); ) {
                String k = it.next();
                out.put(k, o.opt(k));
            }
        }
        return out;
    }

    private static String text(Map<String, Object> a, String name) {
        Object v = a.get(name);
        return v instanceof String ? (String) v : null;
    }
}
