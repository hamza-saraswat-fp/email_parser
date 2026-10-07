import { describe, it, expect } from "vitest";
import { cleanEmail, normalizeWhitespace } from "./clean.js";

describe("cleanEmail", () => {
  it("prefers html and keeps label/value text while dropping links, images and styles", () => {
    const html = `
      <html><head><style>.x{color:red}</style></head><body>
      <img src="logo.png" alt="ServiceChannel">
      <h1>New Service Request</h1>
      <p>Customer</p><p><b>TOPS MARKETS Amherst NY 207</b></p>
      <p>NTE</p><p>1000.00</p>
      <a href="https://example.com/accept">Accept</a>
      </body></html>`;
    const { body, source } = cleanEmail({ html, text: "ignored" });
    expect(source).toBe("html");
    expect(body).toContain("New Service Request");
    expect(body).toContain("TOPS MARKETS Amherst NY 207");
    expect(body).toContain("1000.00");
    expect(body).toContain("Accept");
    expect(body).not.toContain("https://example.com/accept");
    expect(body).not.toContain("color:red");
    expect(body).not.toContain("logo.png");
  });

  it("falls back to text when html is empty", () => {
    const { body, source } = cleanEmail({ html: "  ", text: "Location Address: 300 Main St\r\n\r\n\r\nDepartment: Wareroom" });
    expect(source).toBe("text");
    expect(body).toBe("Location Address: 300 Main St\n\nDepartment: Wareroom");
  });

  it("returns none when both are empty", () => {
    expect(cleanEmail({})).toEqual({ body: "", source: "none" });
  });
});

describe("normalizeWhitespace", () => {
  it("collapses runs of blank lines and trailing spaces", () => {
    expect(normalizeWhitespace("a  \n\n\n\nb\t c\n")).toBe("a\n\nb c");
  });
});
