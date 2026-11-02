"use client";
// Nothing in the app mounts without a real (non-anonymous) session. The sign-in
// renders in place of the page rather than at its own route, so a reminder's deep
// link (/?tp=lunch) survives signing in. An old anonymous session from before
// accounts is signed out here; it can't see anything once RLS is owner-only.
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { SignIn } from "./SignIn";

const real = (s: Session | null) => !!s && !s.user.is_anonymous;

// supabase-js's default storage key. Read directly because getSession() waits on
// a token refresh, which retries for 25s+ on a flaky morning connection.
const KEY = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;
function storedOwner() {
  try {
    const u = JSON.parse(localStorage.getItem(KEY) || "null")?.user;
    return !!u && u.is_anonymous !== true;
  } catch { return false; }
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "out" | "in">("checking");

  useEffect(() => {
    // A stored real session opens the app at once; a refresh the server rejects
    // still lands on sign-in through SIGNED_OUT below.
    // localStorage only exists after hydration, so this can't be initial state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (storedOwner()) setState("in");
    supabase.auth.getSession().then(async ({ data, error }) => {
      // Offline refresh failure: keep the stored session; supabase-js retries later.
      if (error && storedOwner()) return;
      if (data.session?.user.is_anonymous) await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      setState(real(data.session) ? "in" : "out");
    });
    // No awaits inside this callback: supabase-js holds a lock while it runs.
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      if (e !== "INITIAL_SESSION") setState(real(s) ? "in" : "out");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (state === "checking") return null;
  if (state === "out") return <SignIn />;
  return <>{children}</>;
}
