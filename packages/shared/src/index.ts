export type UserId = string;

export interface AppUser {
  id: UserId;
  email: string;
  displayName: string;
}

export interface NextcloudConnectionStatus {
  connected: boolean;
  baseUrl: string | null;
  username: string | null;
  lastSyncAt: string | null;
}

export interface CardSummary {
  id: string;
  name: string;
  tags: string[];
  updatedAt: string;
}
