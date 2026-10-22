"use client";

export type Role = "raghav" | "procurement";
export const ROLE_KEY = "fr-role";

export function getRole(): Role | null {
  try {
    const r = localStorage.getItem(ROLE_KEY);
    return r === "raghav" || r === "procurement" ? r : null;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(typeof body === "object" && body && "detail" in body ? JSON.stringify((body as { detail: unknown }).detail) : `HTTP ${status}`);
  }
}

export function errorMessages(e: unknown): string[] {
  if (e instanceof ApiError) {
    const b = e.body as { detail?: unknown; validation?: { errors?: string[] } };
    if (b?.validation?.errors?.length) return b.validation.errors;
    const d = b?.detail as { errors?: string[] } | string | undefined;
    if (typeof d === "string") return [d];
    if (d && Array.isArray(d.errors)) return d.errors;
    if (Array.isArray(b?.detail)) return (b.detail as { msg: string }[]).map((x) => x.msg);
  }
  return [e instanceof Error ? e.message : String(e)];
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const role = getRole();
  if (role) headers.set("X-Role", role);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const res = await fetch(`/api${path}`, { ...init, headers, cache: "no-store" });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

/** Downloads need the role header, so fetch as a blob and save it. */
export async function download(path: string): Promise<void> {
  const headers = new Headers();
  const role = getRole();
  if (role) headers.set("X-Role", role);
  const res = await fetch(`/api${path}`, { headers });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? "download";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
