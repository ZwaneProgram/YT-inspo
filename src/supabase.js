// Minimal Supabase client over plain REST. No SDK, no bundler.
// Owns two things: the auth session, and every network call.

import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from "./config.js";

const AUTH = () => `${SUPABASE_URL}/auth/v1`;
const REST = () => `${SUPABASE_URL}/rest/v1`;
const SESSION_KEY = "session";

export class ApiError extends Error {
  constructor(message, { status = 0, kind = "error" } = {}) {
    super(message);
    this.status = status;
    this.kind = kind; // "auth" | "offline" | "paused" | "error"
  }
}

// ---------- session storage ----------

export async function getSession() {
  const { [SESSION_KEY]: s } = await chrome.storage.local.get(SESSION_KEY);
  return s || null;
}

async function setSession(s) {
  await chrome.storage.local.set({ [SESSION_KEY]: s });
}

async function clearSession() {
  await chrome.storage.local.remove(SESSION_KEY);
}

function shapeSession(json) {
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    user_id: json.user?.id,
    email: json.user?.email,
    // refresh a minute early so we never hand out a token mid-expiry
    expires_at: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
  };
}

// ---------- auth ----------

export async function signIn(email, password) {
  const res = await rawFetch(`${AUTH()}/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(json.error_description || json.msg || "Sign in failed", {
      status: res.status,
      kind: "auth",
    });
  }
  const session = shapeSession(json);
  await setSession(session);
  return session;
}

export async function signOut() {
  await clearSession();
  await chrome.storage.local.remove("catalog");
}

async function refreshSession() {
  const s = await getSession();
  if (!s?.refresh_token) throw new ApiError("Not signed in", { kind: "auth" });

  const res = await rawFetch(`${AUTH()}/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!res.ok) {
    await clearSession();
    throw new ApiError("Session expired — sign in again", { kind: "auth" });
  }
  const session = shapeSession(await res.json());
  await setSession(session);
  return session;
}

async function validSession() {
  let s = await getSession();
  if (!s) throw new ApiError("Not signed in", { kind: "auth" });
  if (Date.now() >= s.expires_at) s = await refreshSession();
  return s;
}

// ---------- fetch plumbing ----------

// Distinguishes "no internet / project asleep" from a real HTTP error.
async function rawFetch(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (e) {
    throw new ApiError("Can't reach Supabase — offline, or the free project is asleep", {
      kind: "offline",
    });
  }
}

/**
 * Authenticated PostgREST call. Retries exactly once on a 401 after refreshing,
 * so an expired token is invisible rather than an error the user has to see.
 */
async function api(path, { method = "GET", body, headers = {}, retry = true } = {}) {
  if (!isConfigured()) {
    throw new ApiError("Supabase isn't configured yet — edit src/config.js", { kind: "auth" });
  }
  const s = await validSession();

  const res = await rawFetch(`${REST()}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${s.access_token}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && retry) {
    await refreshSession();
    return api(path, { method, body, headers, retry: false });
  }
  if (res.status === 503 || res.status === 544) {
    throw new ApiError("Supabase project is asleep — open your dashboard to wake it", {
      status: res.status,
      kind: "paused",
    });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(text || `Request failed (${res.status})`, { status: res.status });
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------- folders ----------

export const listFolders = () =>
  api("/folders?select=id,name,position&order=position.asc,name.asc");

export async function createFolder(name, position = 0) {
  const rows = await api("/folders", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: { name, position, user_id: (await validSession()).user_id },
  });
  return rows[0];
}

export const renameFolder = (id, name) =>
  api(`/folders?id=eq.${id}`, { method: "PATCH", body: { name } });

export const setFolderPosition = (id, position) =>
  api(`/folders?id=eq.${id}`, { method: "PATCH", body: { position } });

// Channels survive: the FK is ON DELETE SET NULL, so they land in Unsorted.
export const deleteFolder = (id) =>
  api(`/folders?id=eq.${id}`, { method: "DELETE" });

// ---------- channels ----------

export const listChannels = () =>
  api(
    "/channels?select=id,folder_id,platform,platform_id,handle,title,avatar_url,url,created_at" +
      "&order=created_at.desc"
  );

/**
 * Save an account. UNIQUE(user_id, platform, platform_id) means a re-save updates
 * the existing row rather than duplicating it.
 */
export async function upsertChannel(account) {
  const s = await validSession();
  const rows = await api("/channels?on_conflict=user_id,platform,platform_id", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: {
      user_id: s.user_id,
      // Only set folder_id when the caller actually supplied one. The content-script
      // save path never does — it relies on `status` to tell it a channel is already
      // saved — and merge-duplicates means an omitted key here would otherwise send
      // any re-save through this path back to Unsorted, unfiling an already-saved
      // channel. The popup's Save card always passes one explicitly (even `null`).
      ...(account.folder_id !== undefined ? { folder_id: account.folder_id } : {}),
      platform: account.platform,
      platform_id: account.platformId,
      handle: account.handle ?? null,
      title: account.title,
      avatar_url: account.avatarUrl ?? null,
      url: account.url ?? null,
    },
  });
  return rows[0];
}

export const moveChannels = (ids, folderId) =>
  api(`/channels?id=in.(${ids.join(",")})`, {
    method: "PATCH",
    body: { folder_id: folderId },
  });

export const deleteChannels = (ids) =>
  api(`/channels?id=in.(${ids.join(",")})`, { method: "DELETE" });

export const findChannel = (platform, platformId) =>
  api(
    `/channels?platform=eq.${platform}&platform_id=eq.${platformId}` +
      "&select=id,folder_id,title&limit=1"
  );
