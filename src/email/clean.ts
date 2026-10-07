// Turn an inbound email into plain text the model can read. Portal
// notifications are HTML tables of label/value pairs with buttons, logos and
// app-store footers around them; html-to-text keeps the text and drops the rest.
import { convert } from "html-to-text";

export type BodySource = "html" | "text" | "none";

export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "head", format: "skip" },
      // Keep headings as written; html-to-text uppercases them by default.
      { selector: "h1", options: { uppercase: false } },
      { selector: "h2", options: { uppercase: false } },
      { selector: "h3", options: { uppercase: false } },
      { selector: "h4", options: { uppercase: false } },
      { selector: "table", options: { uppercaseHeaderCells: false } },
    ],
  });
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").replace(/\s+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Prefer the HTML part: for portal mail it is the canonical layout, and the
// text part is often missing or a stripped-down duplicate.
export function cleanEmail(fields: { text?: string | null; html?: string | null }): {
  body: string;
  source: BodySource;
} {
  const html = (fields.html ?? "").trim();
  if (html) {
    const body = normalizeWhitespace(htmlToText(html));
    if (body) return { body, source: "html" };
  }
  const text = normalizeWhitespace(fields.text ?? "");
  if (text) return { body: text, source: "text" };
  return { body: "", source: "none" };
}
