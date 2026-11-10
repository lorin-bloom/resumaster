/**
 * Programmatic length enforcement. The model is told the limits, but nothing it returns
 * is trusted: every message passes through these functions before it is stored or shown.
 */

export const LINKEDIN_MAX = 300;

/** Conservative count: the larger of UTF-16 units (what most web textareas count) and code points. */
export function charCount(s: string): number {
  return Math.max(s.length, [...s].length);
}

export function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

export function cleanMessage(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/^["“”']+|["“”']+$/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const BANNED_OUTREACH = [
  /passionate about (your|the) mission/i,
  /pick your brain/i,
  /i believe i('|’)?d be a great fit/i,
  /great fit/i,
  /leverage my (skills|experience)/i,
  /excited to leverage/i,
  /i hope this (message )?finds you well/i,
  /reaching out to (introduce|connect)/i,
  /synerg/i,
  /\bthrilled\b/i,
];

export const AI_CLICHES = [
  /\bdelve\b/i, /\btapestry\b/i, /\bin today'?s fast-paced\b/i, /\bunwavering\b/i, /\btestament to\b/i,
  /\bspearheaded\b/i, /\bpassionate\b/i, /\bresults-driven\b/i, /\bdynamic\b/i, /\bsynerg/i, /\bseasoned\b/i,
  /\bI am excited to\b/i, /\bgame[- ]changer\b/i, /\bin the ever-evolving\b/i,
];

export function bannedHits(s: string, patterns = BANNED_OUTREACH): string[] {
  return patterns.filter((r) => r.test(s)).map((r) => r.source);
}

/** Trim to the limit at a sentence (or clause) boundary. Never cuts mid-word. */
export function trimToChars(s: string, max: number): string {
  if (charCount(s) <= max) return s;
  const sentences = s.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [s];
  let out = "";
  for (const sent of sentences) {
    if (charCount((out + sent).trim()) > max) break;
    out += sent;
  }
  out = out.trim();
  if (out && charCount(out) <= max) return out;
  // fall back to word boundary
  const words = s.split(/\s+/);
  out = "";
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (charCount(next) > max - 1) break;
    out = next;
  }
  return out.replace(/[,;:\-–—]+$/, "") + ".";
}

export function trimToWords(s: string, max: number): string {
  if (wordCount(s) <= max) return s;
  const sentences = s.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [s];
  let out = "";
  for (const sent of sentences) {
    if (wordCount(out + sent) > max) break;
    out += sent;
  }
  return out.trim() || s.split(/\s+/).slice(0, max).join(" ");
}

export function withinLimit(s: string, type: "chars" | "words" | null | undefined, value: number | null | undefined) {
  if (!type || !value) return true;
  return type === "chars" ? charCount(s) <= value : wordCount(s) <= value;
}

export function enforceLinkedIn(s: string): string {
  const c = cleanMessage(s);
  const out = trimToChars(c, LINKEDIN_MAX);
  if (charCount(out) > LINKEDIN_MAX) throw new Error("LinkedIn message exceeds 300 characters after trimming"); // unreachable guard
  return out;
}
