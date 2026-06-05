"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

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
  const [newMessageCount, setNewMessageCount] = useState(0);

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      if (!bottomRef.current) return;
      isProgrammaticScroll.current = true;
      setNewMessageCount(0);
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
      setNewMessageCount(0);
      return;
    }
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    const atBottom = distanceFromBottom < 96;
    isAtBottomRef.current = atBottom;
    if (atBottom) setNewMessageCount(0);
  }, [listRef]);

  useLayoutEffect(() => {
    isAtBottomRef.current = true;
    previousFeedSignal.current = "";
    prevMessagesLength.current = 0;
    queueMicrotask(() => setNewMessageCount(0));
  }, [conversationKey]);

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
    } else if (feed.messages.length > prevMessagesLength.current) {
      const delta = feed.messages.length - prevMessagesLength.current;
      queueMicrotask(() => setNewMessageCount((count) => count + delta));
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

  return { scrollToLatest, handleScroll, newMessageCount };
}
