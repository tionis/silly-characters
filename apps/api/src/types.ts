export type AppUser = {
  id: string;
  email: string | null;
  displayName: string;
};

export type SessionRecord = {
  id: string;
  userId: string;
  expiresAt: number;
};

export type CardCacheRow = {
  id: string;
  user_id: string;
  remote_path: string;
  name: string;
  tags_json: string;
  etag: string | null;
  content_length: number | null;
  last_modified: string | null;
  updated_at: number;
};

export type NextcloudConnectionRow = {
  user_id: string;
  base_url: string;
  username: string;
  app_password_enc: string;
  auth_type: "oauth" | "app_password";
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: number | null;
  nextcloud_user_id: string | null;
  scope: string | null;
  remote_folder: string;
  last_sync_at: number | null;
  created_at: number;
  updated_at: number;
};

export type OauthStateRow = {
  state: string;
  session_id: string;
  created_at: number;
  expires_at: number;
};
