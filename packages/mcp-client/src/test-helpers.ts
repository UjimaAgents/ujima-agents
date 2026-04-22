import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export function makeInMemoryTransportPair(): [Transport, Transport] {
  const a: Transport = {
    start: async () => {
      /* no-op */
    },
    async send(msg: JSONRPCMessage) {
      queueMicrotask(() => b.onmessage?.(msg));
    },
    async close() {
      a.onclose?.();
      b.onclose?.();
    },
  };

  const b: Transport = {
    start: async () => {
      /* no-op */
    },
    async send(msg: JSONRPCMessage) {
      queueMicrotask(() => a.onmessage?.(msg));
    },
    async close() {
      a.onclose?.();
      b.onclose?.();
    },
  };

  return [a, b];
}
