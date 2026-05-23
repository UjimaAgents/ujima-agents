"use client";

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

interface ChatScrollFeed {
  messages: { length: number };
  approvals: { length: number };
  runs: { length: number };
  loading: boolean;
}

interface UseChatScrollToBottomOptions {
  listRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  feed: ChatScrollFeed;
  latestMessageSignal: string;
  pendingApprovalIds: string;
  conversationKey: string;
  virtualizerTotalSize: number;
}

export function useChatScrollToBottom({
  listRef,
  bottomRef,
  feed,
  latestMessageSignal,
  pendingApprovalIds,
  conversationKey,
  virtualizerTotalSize,
}: UseChatScrollToBottomOptions) {
  const isAtBottomRef = useRef(true);
  const previousFeedSignal = useRef("");
  const isProgrammaticScroll = useRef(false);
  const prevMessagesLength = useRef(feed.messages.length);

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      if (!bottomRef.current) return;
      isProgrammaticScroll.current = true;
      bottomRef.current.scrollIntoView({ block: "end", behavior });
      setTimeout(() => {
        isProgrammaticScroll.current = false;
      }, 100);
    },
    [bottomRef],
  );

  const handleScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    if (isProgrammaticScroll.current) {
      isAtBottomRef.current = true;
      return;
    }
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    isAtBottomRef.current = distanceFromBottom < 96;
  }, [listRef]);

  useLayoutEffect(() => {
    isAtBottomRef.current = true;
    previousFeedSignal.current = "";
    prevMessagesLength.current = feed.messages.length;
  }, [conversationKey, feed.messages.length]);

  useLayoutEffect(() => {
    const signal = `${feed.messages.length}:${latestMessageSignal}:${feed.approvals.length}:${feed.runs.length}:${feed.loading ? 1 : 0}:${pendingApprovalIds}`;

    if (!previousFeedSignal.current) {
      previousFeedSignal.current = signal;
      if (feed.messages.length > 0) {
        scrollToLatest("auto");
      }
      prevMessagesLength.current = feed.messages.length;
      return;
    }
    if (previousFeedSignal.current === signal) return;
    previousFeedSignal.current = signal;
    if (isAtBottomRef.current) {
      const isNewMessage = feed.messages.length > prevMessagesLength.current;
      scrollToLatest(isNewMessage ? "smooth" : "auto");
    }
    prevMessagesLength.current = feed.messages.length;
  }, [
    feed.approvals.length,
    feed.loading,
    feed.messages.length,
    feed.runs.length,
    latestMessageSignal,
    pendingApprovalIds,
    scrollToLatest,
  ]);

  useLayoutEffect(() => {
    if (isAtBottomRef.current && feed.messages.length > 0) {
      scrollToLatest("auto");
    }
  }, [virtualizerTotalSize, scrollToLatest, feed.messages.length]);

  return { scrollToLatest, handleScroll };
}
