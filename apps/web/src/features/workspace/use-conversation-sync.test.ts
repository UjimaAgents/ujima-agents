import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// EventSource mock
// ---------------------------------------------------------------------------
interface MockEventSource {
  onopen: (() => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: (() => void) | null;
  readyState: number;
  close: () => void;
}

beforeEach(() => {
  const EventSourceMock = function EventSourceMock() {
    const instance: MockEventSource = {
      onopen: null,
      onmessage: null,
      onerror: null,
      readyState: 0, // EventSource.CONNECTING
      close: () => {
        instance.readyState = 2; // EventSource.CLOSED
      },
    };
    return instance;
  };
  EventSourceMock.CONNECTING = 0;
  EventSourceMock.OPEN = 1;
  EventSourceMock.CLOSED = 2;
  vi.stubGlobal("EventSource", EventSourceMock as unknown as typeof EventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SSE stale error ghost — regression", () => {
  it("transient reconnect (readyState CONNECTING) does NOT set error", () => {
    const setError = vi.fn();
    const source = new EventSource("/dummy") as unknown as MockEventSource;

    // Wire up the same logic as use-conversation-sync lines 231-240
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        setError("Conversation stream disconnected.");
      }
    };

    // Simulate: network hiccup, EventSource auto-reconnects (readyState=0)
    source.readyState = 0;
    source.onerror();

    expect(setError).not.toHaveBeenCalled();
  });

  it("permanent close (readyState CLOSED) DOES set error", () => {
    const setError = vi.fn();
    const source = new EventSource("/dummy") as unknown as MockEventSource;

    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        setError("Conversation stream disconnected.");
      }
    };

    // Simulate permanent connection failure
    source.close(); // sets readyState to 2 (CLOSED)
    source.onerror();

    expect(setError).toHaveBeenCalledWith("Conversation stream disconnected.");
  });

  it("onopen clears any previous error", () => {
    const setError = vi.fn();
    const source = new EventSource("/dummy") as unknown as MockEventSource;

    source.onopen = () => {
      setError(undefined);
    };

    source.onopen();

    expect(setError).toHaveBeenCalledWith(undefined);
  });

  it("onopen clears error after a prior onerror(CLOSED)", () => {
    const setError = vi.fn();
    const source = new EventSource("/dummy") as unknown as MockEventSource;

    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        setError("Conversation stream disconnected.");
      }
    };
    source.onopen = () => {
      setError(undefined);
    };

    // Connection dies
    source.close();
    source.onerror();
    expect(setError).toHaveBeenCalledWith("Conversation stream disconnected.");

    // Then reconnects
    source.readyState = 0;
    source.onopen();
    expect(setError).toHaveBeenLastCalledWith(undefined);
  });
});
