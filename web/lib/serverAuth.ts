import { createClient } from "@supabase/supabase-js";

// API routes that spend the Anthropic key need a signed-in session (bearer token).
// Sign-ups and anonymous sign-ins are off and the owner is the only user, so any
// valid, non-anonymous session is the owner.
export async function signedIn(req: Request): Promise<boolean> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.getUser(token);
  return !error && !!data.user && !data.user.is_anonymous;
}
