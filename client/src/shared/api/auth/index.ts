export type AuthMeResponse = {
  authenticated: boolean;
  user: { id: string; displayName: string; email: string | null } | null;
  nextcloud: {
    connected: boolean;
    baseUrl: string | null;
    username: string | null;
    remoteFolder: string | null;
    lastSyncAt: string | null;
  };
  loginPath: string;
};

export async function getAuthMe(): Promise<AuthMeResponse> {
  const response = await fetch("/api/auth/me", { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Failed to load auth state: ${response.status}`);
  }
  return response.json() as Promise<AuthMeResponse>;
}

export function startNextcloudLogin(loginPath = "/api/auth/login"): void {
  const url = new URL(loginPath, window.location.origin);
  url.searchParams.set("return_to", window.location.origin);
  window.location.href = url.toString();
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
}

export async function syncFromNextcloud(): Promise<void> {
  const response = await fetch("/api/auth/sync", {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Sync failed: ${response.status}`);
  }
}
