// Universal Auth wiring for the SPA. When the two VITE_FP_AUTH_* values are
// absent (local dev), sign-in is skipped entirely and API calls go out bare,
// which matches the backend running without FP_AUTH_URL.
import { configureAuth, getBrowserSupabase } from "@fieldpulse/auth/react";

const url = import.meta.env.VITE_FP_AUTH_URL as string | undefined;
const publishableKey = import.meta.env.VITE_FP_AUTH_PUBLISHABLE_KEY as string | undefined;

export const authEnabled = Boolean(url && publishableKey);

if (authEnabled) {
  configureAuth({ url, publishableKey });
}

export async function authHeaders(): Promise<Record<string, string>> {
  if (!authEnabled) return {};
  const { data } = await getBrowserSupabase().auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
