import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import {
  Alert,
  Button,
  Center,
  Container,
  Group,
  MantineProvider,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { theme } from "@/theme";
import i18n from "@/shared/i18n/i18n";
import {
  $colorScheme,
  loadFromApiFx as loadViewSettingsFx,
} from "@/features/view-settings";
import {
  $settings,
  $isLoading,
  $error,
  loadSettingsFx,
} from "@/entities/settings";
import {
  getAuthMe,
  logout,
  startNextcloudLogin,
  syncFromNextcloud,
  type AuthMeResponse,
} from "@/shared/api/auth";
const HomePage = lazy(() =>
  import("@/pages/home").then((m) => ({ default: m.HomePage }))
);

function ChunkFallback() {
  return (
    <Center h="100vh">
      <Loader size="lg" />
    </Center>
  );
}

export default function App() {
  const [settings, isLoading, error, colorScheme] = useUnit([
    $settings,
    $isLoading,
    $error,
    $colorScheme,
  ]);
  const { t } = useTranslation();
  const [authState, setAuthState] = useState<{
    loading: boolean;
    data: AuthMeResponse | null;
    error: string | null;
  }>({
    loading: true,
    data: null,
    error: null,
  });
  const [authQueryError, setAuthQueryError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const isAuthenticated = Boolean(authState.data?.authenticated);

  useEffect(() => {
    const url = new URL(window.location.href);
    const authError = url.searchParams.get("auth_error");
    if (authError) {
      setAuthQueryError(authError);
      url.searchParams.delete("auth_error");
      url.searchParams.delete("auth");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadAuth = async () => {
      setAuthState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = await getAuthMe();
        if (cancelled) return;
        setAuthState({ loading: false, data, error: null });
      } catch (err) {
        if (cancelled) return;
        setAuthState({
          loading: false,
          data: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
    void loadAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadSettingsFx();
    loadViewSettingsFx();
  }, [isAuthenticated]);

  useEffect(() => {
    // Apply language from persisted settings only after first-run.
    // First-run screen manages language immediately from the form.
    if (!settings) return;
    if (settings.cardsFolderPath === null) return;
    if (i18n.language !== settings.language) {
      void i18n.changeLanguage(settings.language);
    }
  }, [settings?.language, settings?.cardsFolderPath]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let stop: (() => void) | undefined;
    void import("@/features/cards-live-sync").then((m) => {
      m.startLiveSync();
      stop = () => m.stopLiveSync();
    });

    return () => stop?.();
  }, [isAuthenticated]);

  const authErrorBlock = useMemo(() => {
    if (!authState.error && !authQueryError) return null;
    const parts = [authState.error, authQueryError].filter(
      (x): x is string => Boolean(x && x.trim().length > 0)
    );
    if (parts.length === 0) return null;
    return parts.join(" | ");
  }, [authState.error, authQueryError]);

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      window.location.href = "/";
    }
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);
    try {
      await syncFromNextcloud();
      await loadSettingsFx();
      setAuthQueryError(null);
    } catch (err) {
      setAuthQueryError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSyncing(false);
    }
  };

  // Показываем прелоадер при первой загрузке
  if (authState.loading) {
    return (
      <MantineProvider
        theme={theme}
        defaultColorScheme={colorScheme}
        forceColorScheme={colorScheme === "auto" ? undefined : colorScheme}
      >
        <Notifications position="top-right" />
        <Center h="100vh">
          <Loader size="lg" />
        </Center>
      </MantineProvider>
    );
  }

  if (!isAuthenticated) {
    return (
      <MantineProvider
        theme={theme}
        defaultColorScheme={colorScheme}
        forceColorScheme={colorScheme === "auto" ? undefined : colorScheme}
      >
        <Notifications position="top-right" />
        <Center h="100vh" px="md">
          <Container size="xs" w="100%">
            <Paper withBorder radius="md" p="xl">
              <Stack gap="md">
                <Title order={3}>SillyInnkeeper</Title>
                <Text c="dimmed">
                  Sign in with your Nextcloud account to access your character
                  library.
                </Text>
                {authErrorBlock ? (
                  <Alert color="red" title="Login failed">
                    {authErrorBlock}
                  </Alert>
                ) : null}
                <Button
                  onClick={() =>
                    startNextcloudLogin(authState.data?.loginPath ?? "/api/auth/login")
                  }
                >
                  Continue with Nextcloud
                </Button>
              </Stack>
            </Paper>
          </Container>
        </Center>
      </MantineProvider>
    );
  }

  if (isLoading && settings === null) {
    return (
      <MantineProvider
        theme={theme}
        defaultColorScheme={colorScheme}
        forceColorScheme={colorScheme === "auto" ? undefined : colorScheme}
      >
        <Notifications position="top-right" />
        <Center h="100vh">
          <Loader size="lg" />
        </Center>
      </MantineProvider>
    );
  }

  // Показываем ошибку загрузки
  if (error && settings === null) {
    return (
      <MantineProvider
        theme={theme}
        defaultColorScheme={colorScheme}
        forceColorScheme={colorScheme === "auto" ? undefined : colorScheme}
      >
        <Notifications position="top-right" />
        <Container size="md" py="xl">
          <Alert color="red" title={t("errors.loadSettingsTitle")}>
            {error}
          </Alert>
          <Group mt="md">
            <Button onClick={() => loadSettingsFx()}>Retry</Button>
            <Button
              variant="light"
              onClick={() => void handleSyncNow()}
              loading={isSyncing}
            >
              Sync from Nextcloud
            </Button>
            <Button variant="subtle" color="red" onClick={() => void handleLogout()}>
              Logout
            </Button>
          </Group>
        </Container>
      </MantineProvider>
    );
  }

  // В Nextcloud-режиме cards path выставляется после sync/auth callback.
  if (settings?.cardsFolderPath === null) {
    return (
      <MantineProvider
        theme={theme}
        defaultColorScheme={colorScheme}
        forceColorScheme={colorScheme === "auto" ? undefined : colorScheme}
      >
        <Notifications position="top-right" />
        <Center h="100vh" px="md">
          <Container size="sm" w="100%">
            <Paper withBorder radius="md" p="xl">
              <Stack gap="md">
                <Title order={4}>Sync required</Title>
                <Text c="dimmed">
                  Your Nextcloud library is not synced yet. Start a sync to load
                  your cards.
                </Text>
                <Group>
                  <Button
                    onClick={() => void handleSyncNow()}
                    loading={isSyncing}
                  >
                    Sync from Nextcloud
                  </Button>
                  <Button
                    variant="subtle"
                    color="red"
                    onClick={() => void handleLogout()}
                  >
                    Logout
                  </Button>
                </Group>
              </Stack>
            </Paper>
          </Container>
        </Center>
      </MantineProvider>
    );
  }

  // Иначе показываем главную страницу
  return (
    <MantineProvider
      theme={theme}
      defaultColorScheme={colorScheme}
      forceColorScheme={colorScheme === "auto" ? undefined : colorScheme}
    >
      <Notifications position="top-right" />
      <Suspense fallback={<ChunkFallback />}>
        <HomePage
          onSyncNow={() => void handleSyncNow()}
          onLogout={() => void handleLogout()}
          syncInProgress={isSyncing}
        />
      </Suspense>
    </MantineProvider>
  );
}
