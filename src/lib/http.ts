import { NextResponse } from "next/server";
import { AIUnavailableError, SpendLimitError } from "./ai/client";

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(e: unknown) {
  const err = e as Error & { code?: number; response?: { status?: number; data?: { error?: { message?: string } } } };
  const status = err instanceof SpendLimitError ? 402 : err instanceof AIUnavailableError ? 503 : err?.response?.status ?? 500;
  const message = err?.response?.data?.error?.message ?? err?.message ?? "Unexpected error";
  if (status >= 500) console.error(e);
  return NextResponse.json({ error: message, kind: err?.name }, { status: status >= 400 ? status : 500 });
}

export function route<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    try {
      const r = await fn(...args);
      return r instanceof Response ? r : ok(r ?? { ok: true });
    } catch (e) {
      return fail(e);
    }
  };
}

export type Ctx<P> = { params: Promise<P> };
