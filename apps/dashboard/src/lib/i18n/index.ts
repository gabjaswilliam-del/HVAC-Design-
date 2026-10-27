import { en, type Messages } from "./en";

type DeepPartial<T> = {
  [Key in keyof T]?: T[Key] extends readonly unknown[]
    ? T[Key]
    : T[Key] extends (...args: never[]) => unknown
      ? T[Key]
      : T[Key] extends object
        ? DeepPartial<T[Key]>
        : T[Key];
};

export type LocalMessages = DeepPartial<Messages>;

type LocalCatalog = {
  locale: string;
  messages: LocalMessages;
};

type LocalCatalogModule = { default: LocalCatalog };

const localCatalogs = import.meta.glob<LocalCatalogModule>("./*.local.ts", {
  eager: true,
});

function mergeCatalog<T>(base: T, overlay: DeepPartial<T>): T {
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) {
    return (overlay ?? base) as T;
  }

  const merged = { ...base } as T;
  for (const key of Object.keys(overlay) as (keyof T)[]) {
    const next = overlay[key];
    if (next === undefined) continue;
    const current = base[key];
    merged[key] =
      current && next && typeof current === "object" && typeof next === "object" && !Array.isArray(current) && !Array.isArray(next)
        ? mergeCatalog(current, next as DeepPartial<typeof current>)
        : (next as T[keyof T]);
  }
  return merged;
}

function requestedLocale() {
  if (typeof window === "undefined") return "en";
  return new URLSearchParams(window.location.search).get("lang")?.toLowerCase() ?? "en";
}

const locale = requestedLocale();
const localCatalog = Object.values(localCatalogs).find((catalog) => catalog.default.locale === locale)?.default;
const messages = localCatalog ? mergeCatalog(en, localCatalog.messages) : en;

if (typeof document !== "undefined") {
  document.documentElement.lang = localCatalog?.locale ?? "en";
}

export function useStrings(): Messages {
  return messages;
}
