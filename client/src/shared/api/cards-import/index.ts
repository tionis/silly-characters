import i18n from "@/shared/i18n/i18n";
import type { DuplicatesMode } from "@/shared/types/import-settings";

async function readErrorText(response: Response): Promise<string> {
  try {
    const data = (await response.json().catch(() => null)) as any;
    if (data && typeof data === "object") {
      if (typeof data.error === "string" && data.error.trim()) return data.error;
      if (typeof data.message === "string" && data.message.trim())
        return data.message;
    }
  } catch {
    // ignore
  }
  return (await response.text().catch(() => "")).trim();
}

export type StartCardsImportParams = {
  files: File[];
  duplicatesMode: DuplicatesMode;
};

export async function startCardsImport(
  params: StartCardsImportParams
): Promise<{ ok: true; started: true }> {
  const formData = new FormData();
  for (const file of params.files) {
    formData.append("files", file);
  }
  formData.set("duplicatesMode", params.duplicatesMode);

  const response = await fetch("/api/cards/import", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorText = await readErrorText(response);
    if (errorText) throw new Error(errorText);
    throw new Error(`${i18n.t("errors.generic")}: ${response.statusText}`);
  }

  return response.json();
}
