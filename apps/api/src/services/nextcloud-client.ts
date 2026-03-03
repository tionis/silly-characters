import { XMLParser } from "fast-xml-parser";

export type NextcloudDavEntry = {
  remotePath: string;
  name: string;
  isDirectory: boolean;
  etag: string | null;
  contentLength: number | null;
  lastModified: string | null;
};

type NextcloudClientAuth =
  | {
      type: "basic";
      appPassword: string;
    }
  | {
      type: "bearer";
      accessToken: string;
    };

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function normalizeRemotePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "/";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const collapsed = withLeading.replace(/\/{2,}/g, "/");
  if (collapsed !== "/" && collapsed.endsWith("/")) {
    return collapsed.slice(0, -1);
  }
  return collapsed;
}

export function normalizeRemoteFolder(folder: string): string {
  return normalizeRemotePath(folder);
}

function buildAuthHeader(username: string, appPassword: string): string {
  const token = Buffer.from(`${username}:${appPassword}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

function buildBearerHeader(accessToken: string): string {
  return `Bearer ${accessToken}`;
}

function encodeRemotePath(remotePath: string): string {
  const normalized = normalizeRemotePath(remotePath);
  if (normalized === "/") {
    return "/";
  }

  const encodedSegments = normalized
    .slice(1)
    .split("/")
    .map((segment) => encodeURIComponent(segment));

  return `/${encodedSegments.join("/")}`;
}

function parseHrefToRemotePath(href: string, username: string): string | null {
  const rawPath = (() => {
    try {
      return new URL(href).pathname;
    } catch {
      return href;
    }
  })();

  const marker = "/remote.php/dav/files/";
  const markerIndex = rawPath.indexOf(marker);
  if (markerIndex === -1) return null;

  const afterMarker = rawPath.slice(markerIndex + marker.length);
  const candidates = [encodeURIComponent(username), username];

  for (const candidate of candidates) {
    if (afterMarker === candidate) return "/";
    if (afterMarker.startsWith(`${candidate}/`)) {
      const rest = afterMarker.slice(candidate.length);
      const decoded = decodeURIComponent(rest || "/");
      const withLeading = decoded.startsWith("/") ? decoded : `/${decoded}`;
      return normalizeRemotePath(withLeading);
    }
  }

  return null;
}

function extractName(remotePath: string): string {
  const withoutTrailing =
    remotePath !== "/" && remotePath.endsWith("/")
      ? remotePath.slice(0, -1)
      : remotePath;
  const parts = withoutTrailing.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export class NextcloudClient {
  private readonly baseUrl: string;
  private readonly xmlParser: XMLParser;

  constructor(
    rawBaseUrl: string,
    private readonly username: string,
    private readonly auth: NextcloudClientAuth
  ) {
    this.baseUrl = normalizeBaseUrl(rawBaseUrl);
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      removeNSPrefix: true
    });
  }

  private buildDavUrl(remotePath: string): string {
    const encodedPath = encodeRemotePath(remotePath);
    const path = `/remote.php/dav/files/${encodeURIComponent(
      this.username
    )}${encodedPath === "/" ? "/" : encodedPath}`;
    return new URL(path, `${this.baseUrl}/`).toString();
  }

  private async request(
    remotePath: string,
    init: RequestInit
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set(
      "Authorization",
      this.auth.type === "basic"
        ? buildAuthHeader(this.username, this.auth.appPassword)
        : buildBearerHeader(this.auth.accessToken)
    );
    return fetch(this.buildDavUrl(remotePath), { ...init, headers });
  }

  async verifyAccess(remoteFolder: string): Promise<void> {
    await this.listFolder(remoteFolder);
  }

  async listFolder(remoteFolder: string): Promise<NextcloudDavEntry[]> {
    const normalizedFolder = normalizeRemoteFolder(remoteFolder);
    const response = await this.request(normalizedFolder, {
      method: "PROPFIND",
      headers: {
        Depth: "1",
        "Content-Type": "application/xml"
      },
      body: `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getetag />
    <d:getcontenttype />
    <d:getcontentlength />
    <d:getlastmodified />
    <d:resourcetype />
  </d:prop>
</d:propfind>`
    });

    if (response.status !== 207) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Nextcloud PROPFIND failed (${response.status}): ${body.slice(0, 200)}`
      );
    }

    const rawXml = await response.text();
    const parsed = this.xmlParser.parse(rawXml) as {
      multistatus?: { response?: unknown };
    };

    const responsesRaw = parsed?.multistatus?.response;
    const responses = Array.isArray(responsesRaw)
      ? responsesRaw
      : responsesRaw
      ? [responsesRaw]
      : [];

    const entries: NextcloudDavEntry[] = [];

    for (const responseItem of responses as Array<Record<string, unknown>>) {
      const href = String(responseItem.href ?? "");
      if (!href) continue;

      const remotePath = parseHrefToRemotePath(href, this.username);
      if (!remotePath) continue;

      const propstatsRaw = responseItem.propstat;
      const propstats = Array.isArray(propstatsRaw)
        ? propstatsRaw
        : propstatsRaw
        ? [propstatsRaw]
        : [];

      const okPropstat = propstats.find((ps) => {
        const status = String((ps as Record<string, unknown>).status ?? "");
        return status.includes(" 200 ");
      }) as Record<string, unknown> | undefined;

      const prop = (okPropstat?.prop ?? {}) as Record<string, unknown>;
      const resourceType = prop.resourcetype as Record<string, unknown> | undefined;
      const isDirectory = Boolean(resourceType && "collection" in resourceType);

      const etagRaw = prop.getetag;
      const lastModifiedRaw = prop.getlastmodified;
      const contentLengthRaw = prop.getcontentlength;

      const entry: NextcloudDavEntry = {
        remotePath,
        name: extractName(remotePath),
        isDirectory,
        etag:
          typeof etagRaw === "string" && etagRaw.trim().length > 0
            ? etagRaw.trim()
            : null,
        lastModified:
          typeof lastModifiedRaw === "string" && lastModifiedRaw.trim().length > 0
            ? lastModifiedRaw.trim()
            : null,
        contentLength:
          typeof contentLengthRaw === "string" && Number.isFinite(Number(contentLengthRaw))
            ? Number(contentLengthRaw)
            : null
      };

      if (entry.remotePath === normalizedFolder) {
        continue;
      }
      entries.push(entry);
    }

    return entries;
  }

  async readTextFile(remotePath: string): Promise<string | null> {
    const response = await this.request(normalizeRemotePath(remotePath), {
      method: "GET"
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Nextcloud GET failed (${response.status}): ${body.slice(0, 200)}`
      );
    }

    return response.text();
  }

  async writeTextFile(
    remotePath: string,
    content: string,
    contentType = "text/plain; charset=utf-8"
  ): Promise<void> {
    const response = await this.request(normalizeRemotePath(remotePath), {
      method: "PUT",
      headers: {
        "Content-Type": contentType
      },
      body: content
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Nextcloud PUT failed (${response.status}): ${body.slice(0, 200)}`
      );
    }
  }

  async readJsonFile<T>(remotePath: string): Promise<T | null> {
    const content = await this.readTextFile(remotePath);
    if (content === null) {
      return null;
    }

    return JSON.parse(content) as T;
  }

  async writeJsonFile(remotePath: string, value: unknown): Promise<void> {
    const payload = JSON.stringify(value, null, 2);
    await this.writeTextFile(remotePath, payload, "application/json; charset=utf-8");
  }

  async ensureFolderExists(remoteFolder: string): Promise<void> {
    const normalizedFolder = normalizeRemoteFolder(remoteFolder);
    if (normalizedFolder === "/") {
      return;
    }

    const segments = normalizedFolder
      .slice(1)
      .split("/")
      .filter((segment) => segment.length > 0);

    let current = "";
    for (const segment of segments) {
      current = `${current}/${segment}`;
      const response = await this.request(current, {
        method: "MKCOL"
      });

      if (response.status === 201 || response.status === 405) {
        continue;
      }

      if (response.status === 301 || response.status === 302) {
        continue;
      }

      const body = await response.text().catch(() => "");
      throw new Error(
        `Nextcloud MKCOL failed (${response.status}): ${body.slice(0, 200)}`
      );
    }
  }
}
