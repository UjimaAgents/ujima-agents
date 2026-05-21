"use client";

import { useEffect } from "react";

export function useOpenAICodexOAuth(onToken: (token: string) => void, onError?: (message: string) => void) {
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== "OAUTH_SUCCESS") return;

      const token = event.data.token;
      if (token) {
        onToken(token);
        return;
      }

      if (event.data.error) {
        const message = String(event.data.error);
        if (onError) {
          onError(message);
        } else {
          alert(`OAuth Error: ${message}`);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onToken, onError]);
}
