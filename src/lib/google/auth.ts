import { google } from "googleapis";
import type { Credentials } from "google-auth-library";
import { deleteSetting, getSetting, setSetting } from "../db";

export const SCOPES = [
  "openid",
  "email",
  // read master + previous resumes the user selects
  "https://www.googleapis.com/auth/drive.readonly",
  // create the "Resumaster Applications" folder, copies, and PDF exports
  "https://www.googleapis.com/auth/drive.file",
  // apply approved edits to the copies
  "https://www.googleapis.com/auth/documents",
];

export function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function redirectUri() {
  return process.env.GOOGLE_REDIRECT_URI ?? `${process.env.APP_URL ?? "http://localhost:3000"}/api/auth/callback`;
}

export function oauthClient() {
  if (!googleConfigured()) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set. See README → Google setup.");
  const c = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri());
  const tokens = getSetting<Credentials>("google_tokens");
  if (tokens) c.setCredentials(tokens);
  // Persist refreshed tokens so the refresh token survives restarts.
  c.on("tokens", (t) => {
    const prev = getSetting<Credentials>("google_tokens") ?? {};
    setSetting("google_tokens", { ...prev, ...t });
  });
  return c;
}

export function authUrl(state: string) {
  return oauthClient().generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES, state, include_granted_scopes: true });
}

export async function handleCallback(code: string) {
  const c = oauthClient();
  const { tokens } = await c.getToken(code);
  setSetting("google_tokens", tokens);
  c.setCredentials(tokens);
  const info = await google.oauth2({ version: "v2", auth: c }).userinfo.get();
  setSetting("google_email", info.data.email ?? "");
}

export function isConnected() {
  return !!getSetting<Credentials>("google_tokens")?.refresh_token;
}

export function disconnect() {
  deleteSetting("google_tokens");
  deleteSetting("google_email");
}

export function apis() {
  const auth = oauthClient();
  if (!isConnected()) throw new Error("Google account is not connected.");
  return { docs: google.docs({ version: "v1", auth }), drive: google.drive({ version: "v3", auth }) };
}
