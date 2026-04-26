export const UJIMA_WEB_SESSION_KEY = "ujima-web-session-v1";
const UJIMA_WEB_SESSION_EVENT = "ujima-web-session-change";

export interface UjimaWebSession {
  organizationId: string;
  organizationName: string;
  ownerName: string;
  loggedInAt: string;
}

let cachedRawSession: string | null = null;
let cachedParsedSession: UjimaWebSession | null = null;

function emitSessionChange() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(UJIMA_WEB_SESSION_EVENT));
}

function parseSession(raw: string | null): UjimaWebSession | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<UjimaWebSession>;

    if (
      typeof parsed.organizationId !== "string" ||
      typeof parsed.organizationName !== "string" ||
      typeof parsed.ownerName !== "string" ||
      typeof parsed.loggedInAt !== "string"
    ) {
      return null;
    }

    return {
      organizationId: parsed.organizationId,
      organizationName: parsed.organizationName,
      ownerName: parsed.ownerName,
      loggedInAt: parsed.loggedInAt,
    };
  } catch {
    return null;
  }
}

export function readWebSession(): UjimaWebSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(UJIMA_WEB_SESSION_KEY);

  if (raw === cachedRawSession) {
    return cachedParsedSession;
  }

  cachedRawSession = raw;
  cachedParsedSession = parseSession(raw);
  return cachedParsedSession;
}

export function writeWebSession(session: UjimaWebSession) {
  if (typeof window === "undefined") {
    return;
  }

  const raw = JSON.stringify(session);
  cachedRawSession = raw;
  cachedParsedSession = session;
  window.localStorage.setItem(UJIMA_WEB_SESSION_KEY, raw);
  emitSessionChange();
}

export function clearWebSession() {
  if (typeof window === "undefined") {
    return;
  }

  cachedRawSession = null;
  cachedParsedSession = null;
  window.localStorage.removeItem(UJIMA_WEB_SESSION_KEY);
  emitSessionChange();
}

export function subscribeToWebSession(callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: Event) => {
    if (event instanceof StorageEvent && event.key && event.key !== UJIMA_WEB_SESSION_KEY) {
      return;
    }

    callback();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(UJIMA_WEB_SESSION_EVENT, handleStorage);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(UJIMA_WEB_SESSION_EVENT, handleStorage);
  };
}
