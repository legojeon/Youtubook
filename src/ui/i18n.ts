type GetMessage = (key: string, subs?: string[]) => string;

function chromeGetMessage(key: string, subs?: string[]): string {
  const c = (globalThis as { chrome?: { i18n?: { getMessage?: GetMessage } } }).chrome;
  return c?.i18n?.getMessage?.(key, subs) ?? '';
}

/** Localize a dynamic string; falls back to the key when chrome.i18n is unavailable (tests). */
export function t(key: string, ...subs: string[]): string {
  const msg = chromeGetMessage(key, subs.length ? subs : undefined);
  return msg || key;
}

/** Fill `[data-i18n]` (textContent), `[data-i18n-title]`, `[data-i18n-placeholder]` in `root`. */
export function applyI18n(root: ParentNode, getMessage: GetMessage = chromeGetMessage): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    const m = getMessage(el.dataset.i18n as string);
    if (m) el.textContent = m;
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
    const m = getMessage(el.dataset.i18nTitle as string);
    if (m) el.title = m;
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach(el => {
    const m = getMessage(el.dataset.i18nPlaceholder as string);
    if (m) el.placeholder = m;
  });
}
