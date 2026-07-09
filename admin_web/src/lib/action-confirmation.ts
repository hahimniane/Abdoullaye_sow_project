import {
  currentWebLanguage,
  type SupportedLanguage,
} from "./language.ts";

export type ActionConfirmationOptions = {
  confirm?: string;
  confirmFr?: string;
};

export type ActionRunner = (
  label: string,
  action: () => Promise<unknown>,
  options?: ActionConfirmationOptions,
) => Promise<void> | void;

export function confirmationMessage(
  english: string,
  french?: string,
  language: SupportedLanguage = currentWebLanguage(),
) {
  return language === "fr" ? (french || english) : english;
}

export function confirmImportantAction(
  english: string,
  french?: string,
) {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }
  return window.confirm(confirmationMessage(english, french));
}
