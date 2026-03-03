export type HealthResponse = {
  ok: boolean;
  service: string;
  now: string;
};

export type AppUser = {
  id: string;
  email: string | null;
  displayName: string;
};

export type NextcloudStatusResponse = {
  connected: boolean;
  authType: "oauth" | "app_password" | null;
  baseUrl: string | null;
  username: string | null;
  remoteFolder: string | null;
  lastSyncAt: string | null;
};

export type AuthResponse = {
  authenticated: boolean;
  user: AppUser | null;
  nextcloud: NextcloudStatusResponse;
  loginPath: string;
};

export type CardListItem = {
  id: string;
  remotePath: string;
  name: string;
  tags: string[];
  etag: string | null;
  contentLength: number | null;
  lastModified: string | null;
  updatedAt: string;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const details =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error ?? "")
        : "";
    throw new Error(details || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  getHealth: () => fetchJson<HealthResponse>("/api/health"),
  getAuth: () => fetchJson<AuthResponse>("/api/auth/me"),
  getLoginUrl: () => fetchJson<{ ok: true; url: string }>("/api/auth/login-url"),
  logout: () => fetchJson<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  updateProfile: (input: { displayName: string; email?: string | null }) =>
    fetchJson<{ ok: boolean; user: AppUser }>("/api/auth/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  getNextcloudStatus: () => fetchJson<NextcloudStatusResponse>("/api/nextcloud/status"),
  updateRemoteFolder: (remoteFolder: string) =>
    fetchJson<{ ok: boolean; status: NextcloudStatusResponse }>(
      "/api/nextcloud/remote-folder",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remoteFolder })
      }
    ),
  disconnectNextcloud: () =>
    fetchJson<{ ok: boolean }>("/api/nextcloud/connect", { method: "DELETE" }),
  syncCards: () =>
    fetchJson<{
      ok: boolean;
      scannedFiles: number;
      upsertedCards: number;
      removedCards: number;
      metadataWarning: string | null;
    }>("/api/cards/sync", { method: "POST" }),
  getCards: () => fetchJson<{ items: CardListItem[]; total: number }>("/api/cards")
};
