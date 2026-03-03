import { useEffect, useMemo, useState } from "react";
import { api, type AppUser, type NextcloudStatusResponse } from "./api";

type LoadState = "idle" | "loading" | "ready" | "error";

type CardRow = {
  id: string;
  remotePath: string;
  name: string;
  updatedAt: string;
};

const DEFAULT_NEXTCLOUD: NextcloudStatusResponse = {
  connected: false,
  authType: null,
  baseUrl: null,
  username: null,
  remoteFolder: null,
  lastSyncAt: null
};

export default function App() {
  const [state, setState] = useState<LoadState>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const [health, setHealth] = useState("n/a");
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<AppUser | null>(null);
  const [nextcloud, setNextcloud] = useState<NextcloudStatusResponse>(DEFAULT_NEXTCLOUD);
  const [remoteFolderDraft, setRemoteFolderDraft] = useState("/characters");

  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");

  const [cards, setCards] = useState<CardRow[]>([]);
  const [syncStats, setSyncStats] = useState("");

  const cardsCountLabel = useMemo(() => `${cards.length} indexed cards`, [cards.length]);

  const loadDashboard = async (): Promise<void> => {
    setState("loading");
    setError("");

    try {
      const [healthData, authData] = await Promise.all([api.getHealth(), api.getAuth()]);

      setHealth(`${healthData.ok ? "ok" : "fail"} (${healthData.service})`);
      setAuthenticated(authData.authenticated);
      setUser(authData.user);
      setNextcloud(authData.nextcloud);
      setProfileDisplayName(authData.user?.displayName ?? "");
      setProfileEmail(authData.user?.email ?? "");
      setRemoteFolderDraft(authData.nextcloud.remoteFolder ?? "/characters");

      if (authData.authenticated) {
        const cardsData = await api.getCards();
        setCards(
          cardsData.items.map((item) => ({
            id: item.id,
            remotePath: item.remotePath,
            name: item.name,
            updatedAt: item.updatedAt
          }))
        );
      } else {
        setCards([]);
      }

      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authResult = params.get("auth");
    const authError = params.get("auth_error");

    if (authResult === "success") {
      setStatusMessage("Signed in successfully.");
    } else if (authError) {
      setError(`OAuth failed: ${authError}`);
    }

    if (authResult || authError) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    void loadDashboard();
  }, []);

  const runAction = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const startOAuthLogin = (): Promise<void> =>
    runAction(async () => {
      const { url } = await api.getLoginUrl();
      window.location.href = url;
    });

  const logout = (): Promise<void> =>
    runAction(async () => {
      await api.logout();
      setSyncStats("");
      setStatusMessage("Logged out.");
      await loadDashboard();
    });

  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">SillyInnkeeper</p>
        <h1>Nextcloud Character Manager</h1>
        <p className="subtitle">
          Web app flow: visit, sign in with Nextcloud OAuth, then manage cards.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <h2>API Health</h2>
          <p>{health}</p>
        </article>
        <article className="card">
          <h2>Session</h2>
          <p>{authenticated ? user?.displayName ?? "Signed in" : "Anonymous"}</p>
        </article>
        <article className="card">
          <h2>Cards</h2>
          <p>{cardsCountLabel}</p>
        </article>
      </section>

      {!authenticated ? (
        <section className="panel">
          <h2>Sign In</h2>
          <p className="muted">
            Sign in with your Nextcloud account to access your shared character
            library.
          </p>
          <div className="actions">
            <button disabled={busy} onClick={() => void startOAuthLogin()}>
              Sign in with Nextcloud
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="panel">
            <h2>Account</h2>
            <p className="muted">
              Connected as {nextcloud.username} @ {nextcloud.baseUrl}
            </p>
            <div className="actions">
              <button disabled={busy} onClick={() => void logout()}>
                Logout
              </button>
            </div>
          </section>

          <section className="panel">
            <h2>Profile</h2>
            <div className="form-grid">
              <label>
                Display Name
                <input
                  value={profileDisplayName}
                  onChange={(event) => setProfileDisplayName(event.target.value)}
                  placeholder="Display name"
                />
              </label>
              <label>
                Email
                <input
                  value={profileEmail}
                  onChange={(event) => setProfileEmail(event.target.value)}
                  placeholder="user@example.com"
                />
              </label>
            </div>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() =>
                  void runAction(async () => {
                    await api.updateProfile({
                      displayName: profileDisplayName.trim() || "User",
                      email: profileEmail.trim() || null
                    });
                    setStatusMessage("Profile saved.");
                    await loadDashboard();
                  })
                }
              >
                Save Profile
              </button>
            </div>
          </section>

          <section className="panel">
            <h2>Library</h2>
            <div className="form-grid">
              <label>
                Remote Folder
                <input
                  value={remoteFolderDraft}
                  onChange={(event) => setRemoteFolderDraft(event.target.value)}
                  placeholder="/characters"
                />
              </label>
            </div>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() =>
                  void runAction(async () => {
                    await api.updateRemoteFolder(remoteFolderDraft);
                    setStatusMessage("Remote folder updated.");
                    await loadDashboard();
                  })
                }
              >
                Save Folder
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void runAction(async () => {
                    const result = await api.syncCards();
                    setSyncStats(
                      `Synced ${result.scannedFiles} files, removed ${result.removedCards}.`
                    );
                    if (result.metadataWarning) {
                      setStatusMessage(
                        `Synced with warning: ${result.metadataWarning}`
                      );
                    } else {
                      setStatusMessage("Sync finished.");
                    }
                    await loadDashboard();
                  })
                }
              >
                Sync Cards
              </button>
            </div>
            {nextcloud.lastSyncAt ? (
              <p className="muted">
                Last sync: {new Date(nextcloud.lastSyncAt).toLocaleString()}
              </p>
            ) : null}
            {syncStats ? <p className="muted">{syncStats}</p> : null}
          </section>

          <section className="panel">
            <h2>Indexed Cards</h2>
            {cards.length === 0 ? (
              <p className="muted">No cards indexed yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Remote Path</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cards.map((card) => (
                      <tr key={card.id}>
                        <td>{card.name}</td>
                        <td>{card.remotePath}</td>
                        <td>{new Date(card.updatedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {statusMessage ? (
        <section className="status">
          <strong>Status:</strong> {statusMessage}
        </section>
      ) : null}

      <section className="status">
        <strong>UI State:</strong> {state}
      </section>

      {error ? (
        <section className="error">
          <strong>Error:</strong> {error}
        </section>
      ) : null}
    </main>
  );
}
