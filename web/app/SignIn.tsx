"use client";
// Email + one-time code (Supabase OTP). A code, not a magic link: the link would
// open Safari instead of the home-screen app. Needs {{ .Token }} in the Magic Link
// and Confirm signup email templates. New sign-ups are turned off in Supabase Auth
// once the owner exists, so shouldCreateUser only matters for that first sign-in.
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { supabase } from "@/lib/supabaseClient";

const EASE = [0.16, 1, 0.3, 1] as const;

export function SignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const el = document.documentElement;
    el.classList.add("locked");
    window.scrollTo(0, 0);
    return () => el.classList.remove("locked");
  }, []);

  const send = async () => {
    const e = email.trim().toLowerCase();
    if (busy || !e.includes("@")) return;
    setBusy(true); setNote(null);
    const { error } = await supabase.auth.signInWithOtp({ email: e, options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) { setNote(error.status === 429 ? "Too many codes. Wait a minute and try again." : "Couldn't send a code to that address."); return; }
    setCode(""); setSent(true);
  };

  const verify = async () => {
    if (busy || code.length < 6) return;
    setBusy(true); setNote(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: "email" });
    // On success AuthGate hears SIGNED_IN and swaps this screen for the app.
    if (error) { setBusy(false); setNote("That code didn't work. Check it, or send a new one."); }
  };

  return (
    <motion.div className="onboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <AnimatePresence mode="wait">
        {!sent ? (
          <motion.form key="e" className="ob-card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }}
            transition={{ duration: 0.42, ease: EASE }} onSubmit={(ev) => { ev.preventDefault(); send(); }}>
            <div className="ob-h">Sign in to CALIBEX.</div>
            <p className="ob-p">We&apos;ll email you a code. No password.</p>
            <input className="ob-name" type="email" inputMode="email" autoComplete="email" autoCapitalize="none"
              autoCorrect="off" spellCheck={false} placeholder="Email" aria-label="Email"
              value={email} onChange={(ev) => setEmail(ev.target.value)} />
            {note && <p className="ob-note">{note}</p>}
          </motion.form>
        ) : (
          <motion.form key="c" className="ob-card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }}
            transition={{ duration: 0.42, ease: EASE }} onSubmit={(ev) => { ev.preventDefault(); verify(); }}>
            <div className="ob-h">Check your email.</div>
            <p className="ob-p">Enter the code sent to <b>{email.trim()}</b>.</p>
            <input className="ob-name ob-code mono" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*"
              maxLength={10} placeholder="Code" aria-label="Sign-in code" autoFocus
              value={code} onChange={(ev) => setCode(ev.target.value.replace(/\D/g, ""))} />
            {note && <p className="ob-note">{note}</p>}
          </motion.form>
        )}
      </AnimatePresence>
      <div className="ob-foot">
        {!sent
          ? <motion.button className="ob-btn" whileTap={{ scale: 0.97 }} disabled={busy || !email.includes("@")} onClick={send}>{busy ? "…" : "Email me a code"}</motion.button>
          : <motion.button className="ob-btn" whileTap={{ scale: 0.97 }} disabled={busy || code.length < 6} onClick={verify}>{busy ? "…" : "Sign in"}</motion.button>}
        {sent && (
          <div className="ob-links">
            <button className="ob-skip" disabled={busy} onClick={() => { setSent(false); setNote(null); }}>different email</button>
            <button className="ob-skip" disabled={busy} onClick={send}>new code</button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
