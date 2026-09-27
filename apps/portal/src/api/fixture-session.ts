/** The fixture preview's stand-in for the portal session cookie: which link this tab opened. */
export interface FixtureSessionStore {
  readonly read: () => string | null;
  readonly open: (linkId: string) => void;
}

const storageKey = 'pl.portal.fixtureSession';

/**
 * Keeps the opened link for the tab, so a reload stays in the session as a cookie would.
 * Session storage can be unavailable (private windows, blocked storage); the session then lasts
 * until the page reloads.
 */
export function createFixtureSessionStore(storage: () => Storage = () => window.sessionStorage): FixtureSessionStore {
  let current: string | null = null;
  try {
    current = storage().getItem(storageKey);
  } catch {
    current = null;
  }
  return {
    read: () => current,
    open(linkId) {
      current = linkId;
      try {
        storage().setItem(storageKey, linkId);
      } catch {
        // The in-memory session still serves this page.
      }
    },
  };
}
