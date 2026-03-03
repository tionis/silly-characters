import type { Language } from "../services/settings";

let currentLanguage: Language = "en";

export function getCurrentLanguage(): Language {
  return currentLanguage;
}

export function setCurrentLanguage(language: Language): void {
  currentLanguage = language;
}
