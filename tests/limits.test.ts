import { describe, expect, it } from "vitest";
import { LINKEDIN_MAX, bannedHits, charCount, enforceLinkedIn, trimToWords, withinLimit } from "@/lib/limits";
import { PRECOMPUTED_OUTREACH } from "@/lib/demo/precomputed";

describe("LinkedIn 300-character limit (programmatic)", () => {
  it("never returns more than 300 characters", () => {
    const long = "Hi Sam — I applied for the Staff PMM role. ".repeat(20);
    const out = enforceLinkedIn(long);
    expect(charCount(out)).toBeLessThanOrEqual(LINKEDIN_MAX);
    expect(out.length).toBeGreaterThan(200);
  });

  it("counts emoji/astral characters conservatively", () => {
    const s = "🚀".repeat(160); // 160 code points, 320 UTF-16 units
    expect(charCount(s)).toBe(320);
    expect(charCount(enforceLinkedIn(s + " done."))).toBeLessThanOrEqual(LINKEDIN_MAX);
  });

  it("leaves compliant messages untouched apart from whitespace/quotes", () => {
    expect(enforceLinkedIn(`"Hi Ana,  I applied for the PMM role."`)).toBe("Hi Ana, I applied for the PMM role.");
  });

  it("trims at sentence boundaries, never mid-word", () => {
    const msg = "I applied for the Product Marketing Lead role. " + "I led an API launch with 1,400 sign-ups in 90 days and cut onboarding time sharply. ".repeat(4);
    const out = enforceLinkedIn(msg);
    expect(out.endsWith(".")).toBe(true);
    expect(charCount(out)).toBeLessThanOrEqual(300);
  });

  it("fuzz: 2,000 random messages all end ≤ 300", () => {
    const words = ["API", "launch", "1,400", "developers", "—", "pricing", "Hi", "Sam,", "I", "applied", "for", "the", "role.", "😀", "win-rate", "18%→26%"];
    for (let i = 0; i < 2000; i++) {
      const n = 20 + Math.floor(Math.random() * 120);
      const msg = Array.from({ length: n }, () => words[Math.floor(Math.random() * words.length)]).join(" ");
      expect(charCount(enforceLinkedIn(msg))).toBeLessThanOrEqual(LINKEDIN_MAX);
    }
  });

  it("detects banned generic phrases", () => {
    expect(bannedHits("I'm passionate about your mission and would love to pick your brain")).toHaveLength(2);
    expect(bannedHits("I led an API launch with 1,400 sign-ups.")).toHaveLength(0);
  });

  it("demo precomputed outreach is within limit and clean", () => {
    expect(charCount(PRECOMPUTED_OUTREACH.message)).toBeLessThanOrEqual(300);
    expect(bannedHits(PRECOMPUTED_OUTREACH.message)).toHaveLength(0);
  });
});

describe("answer limits", () => {
  it("word and char limits", () => {
    expect(withinLimit("one two three", "words", 3)).toBe(true);
    expect(withinLimit("one two three four", "words", 3)).toBe(false);
    expect(withinLimit("abcd", "chars", 3)).toBe(false);
    expect(trimToWords("One two three. Four five six. Seven.", 6)).toBe("One two three. Four five six.");
  });
});
