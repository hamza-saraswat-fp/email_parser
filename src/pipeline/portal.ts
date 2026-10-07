// Cheap, deterministic portal detection from the sender. The model confirms
// or overrides it when the sender is a forwarder (e.g. a manual "Fwd:").
import type { Portal } from "../schema/record.js";

const DOMAIN_HINTS: Array<[RegExp, Portal]> = [
  // ServiceChannel dispatches from scalert.com as well as servicechannel.com/.net.
  [/servicechannel\.(com|net)$/i, "servicechannel"],
  [/scalert\.com$/i, "servicechannel"],
  [/corrigo(pro)?\.com$/i, "corrigo"],
  [/heb\.com$/i, "heb"],
  [/fexa\.io$/i, "fexa"],
  [/servicepower\.com$/i, "servicepower"],
];

export function portalFromSender(fromEmail: string | null): Portal | null {
  if (!fromEmail) return null;
  const domain = fromEmail.split("@")[1]?.trim();
  if (!domain) return null;
  for (const [re, portal] of DOMAIN_HINTS) {
    if (re.test(domain)) return portal;
  }
  return null;
}

// Also look inside the body: a manually forwarded email carries the original
// sender in a "From:" line.
export function portalFromBody(body: string): Portal | null {
  const m = body.match(/^From:.*?<?([\w.+-]+@[\w.-]+)>?/im);
  return m ? portalFromSender(m[1]) : null;
}
