import { z } from "zod";
import { normalizeBaseUrl } from "./nextcloud-client";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.coerce.number().int().positive().default(3600),
  refresh_token: z.string().optional(),
  scope: z.string().optional()
});

const ocsUserResponseSchema = z.object({
  ocs: z.object({
    meta: z.object({
      status: z.string(),
      statuscode: z.number()
    }),
    data: z.object({
      id: z.string().min(1),
      displayname: z.string().optional(),
      email: z.string().email().nullable().optional()
    })
  })
});

type OAuthConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type NextcloudTokenResult = {
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAtMs: number;
  scope: string | null;
};

export type NextcloudOAuthUser = {
  nextcloudUserId: string;
  displayName: string;
  email: string | null;
};

function getOAuthConfig(): OAuthConfig {
  const baseUrl = String(process.env.NEXTCLOUD_BASE_URL ?? "").trim();
  const clientId = String(process.env.NEXTCLOUD_APP_ID ?? "").trim();
  const clientSecret = String(process.env.NEXTCLOUD_APP_SECRET ?? "").trim();
  const redirectUri = String(process.env.NEXTCLOUD_REDIRECT_URI ?? "").trim();

  if (!baseUrl) throw new Error("NEXTCLOUD_BASE_URL is not configured");
  if (!clientId) throw new Error("NEXTCLOUD_APP_ID is not configured");
  if (!clientSecret) throw new Error("NEXTCLOUD_APP_SECRET is not configured");
  if (!redirectUri) throw new Error("NEXTCLOUD_REDIRECT_URI is not configured");

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    clientId,
    clientSecret,
    redirectUri
  };
}

function buildOAuthError(
  stage: string,
  response: Response,
  bodyText: string
): Error {
  return new Error(
    `${stage} failed (${response.status}): ${bodyText.slice(0, 200)}`
  );
}

async function postTokenRequest(
  body: URLSearchParams
): Promise<NextcloudTokenResult> {
  const config = getOAuthConfig();
  const response = await fetch(`${config.baseUrl}/apps/oauth2/api/v1/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const bodyText = await response.text().catch(() => "");
  if (!response.ok) {
    throw buildOAuthError("Token exchange", response, bodyText);
  }

  const parsedJson = JSON.parse(bodyText) as unknown;
  const parsed = tokenResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error("Invalid token response from Nextcloud");
  }

  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token ?? null,
    tokenExpiresAtMs: Date.now() + parsed.data.expires_in * 1000,
    scope: parsed.data.scope ?? null
  };
}

export function buildNextcloudAuthorizeUrl(state: string): string {
  const config = getOAuthConfig();
  const url = new URL(`${config.baseUrl}/apps/oauth2/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCodeForToken(
  code: string
): Promise<NextcloudTokenResult> {
  const config = getOAuthConfig();
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", config.redirectUri);
  body.set("client_id", config.clientId);
  body.set("client_secret", config.clientSecret);
  return postTokenRequest(body);
}

export async function refreshNextcloudToken(
  refreshToken: string
): Promise<NextcloudTokenResult> {
  const config = getOAuthConfig();
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);
  body.set("client_id", config.clientId);
  body.set("client_secret", config.clientSecret);
  body.set("redirect_uri", config.redirectUri);
  return postTokenRequest(body);
}

export async function fetchNextcloudOAuthUser(
  accessToken: string
): Promise<NextcloudOAuthUser> {
  const config = getOAuthConfig();
  const candidates = [
    `${config.baseUrl}/ocs/v2.php/cloud/user?format=json`,
    `${config.baseUrl}/ocs/v1.php/cloud/user?format=json`
  ];

  let lastError: Error | null = null;
  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "OCS-APIRequest": "true",
          Accept: "application/json"
        }
      });

      const bodyText = await response.text().catch(() => "");
      if (!response.ok) {
        throw buildOAuthError("User lookup", response, bodyText);
      }

      const parsedJson = JSON.parse(bodyText) as unknown;
      const parsed = ocsUserResponseSchema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new Error("Invalid OCS user response");
      }

      const raw = parsed.data.ocs.data;
      const displayName = raw.displayname?.trim() || raw.id;
      return {
        nextcloudUserId: raw.id,
        displayName,
        email: raw.email ?? null
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Failed to fetch Nextcloud user profile");
}

export function getOAuthBaseUrl(): string {
  return getOAuthConfig().baseUrl;
}
