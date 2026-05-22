"use client";

import { OPENAI_OAUTH_LOGIN_PATH } from "./constants";

export function OpenAISignInButton({
  signedIn,
  onClick,
  className = "min-w-0 flex-1",
}: {
  signedIn: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg bg-[#10a37f] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#0e906f] ${className}`}
    >
      {signedIn ? "Signed in with OpenAI" : "Sign in with OpenAI"}
    </button>
  );
}

export function openOpenAIOAuthPopup() {
  window.open(OPENAI_OAUTH_LOGIN_PATH, "oauth_popup", "width=500,height=600");
}
