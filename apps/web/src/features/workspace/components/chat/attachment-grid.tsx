"use client";

import { useEffect, useMemo, useState } from "react";
import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  X,
} from "lucide-react";
import type { ChatMessageData } from "./chat-message";

type Attachment = NonNullable<ChatMessageData["attachments"]>[number];

export function AttachmentGrid({
  attachments,
  organizationId,
}: {
  attachments?: ChatMessageData["attachments"];
  organizationId: string;
}) {
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const images = useMemo(
    () => attachments?.filter((attachment) => attachment.category === "image") ?? [],
    [attachments],
  );
  const others = useMemo(
    () => attachments?.filter((attachment) => attachment.category !== "image") ?? [],
    [attachments],
  );
  const activeImage = images.find((attachment) => attachment.id === activeImageId) ?? null;

  useEffect(() => {
    if (!activeImageId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveImageId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeImageId]);

  if (!organizationId || !attachments?.length) return null;

  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((attachment) => (
            <button
              key={attachment.id}
              type="button"
              onClick={() => setActiveImageId(attachment.id)}
              className="group overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 text-left transition hover:ring-2 hover:ring-violet-500/40 dark:border-zinc-800 dark:bg-zinc-900/60"
            >
              {/* Same-origin attachment proxy; next/image does not apply cleanly to auth-cookie fetches. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachmentUrl(organizationId, attachment.id, true)}
                alt={attachment.filename}
                className="h-40 w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      ) : null}

      {others.length > 0 ? (
        <div className="space-y-2">
          {others.map((attachment) => (
            <AttachmentCard
              key={attachment.id}
              attachment={attachment}
              organizationId={organizationId}
            />
          ))}
        </div>
      ) : null}

      {activeImage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setActiveImageId(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw]"
            onClick={(event) => event.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachmentUrl(organizationId, activeImage.id, true)}
              alt={activeImage.filename}
              className="max-h-[90vh] max-w-[90vw] rounded-2xl border border-white/10 object-contain shadow-2xl"
            />
            <div className="mt-3 flex items-center justify-between gap-3 text-white">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{activeImage.filename}</p>
                <p className="text-xs text-white/70">{formatBytes(activeImage.sizeBytes)}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveImageId(null)}
                className="rounded-full border border-white/10 bg-white/10 p-2 text-white transition hover:bg-white/20"
                aria-label="Close image preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AttachmentCard({
  attachment,
  organizationId,
}: {
  attachment: Attachment;
  organizationId: string;
}) {
  const url = attachmentUrl(organizationId, attachment.id);

  if (attachment.category === "audio") {
    return (
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
        <div className="mb-2 flex items-center gap-2">
          <AttachmentIcon category={attachment.category} className="h-4 w-4 text-violet-600 dark:text-violet-300" />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              {attachment.filename}
            </p>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {formatBytes(attachment.sizeBytes)}
            </p>
          </div>
        </div>
        <audio controls className="w-full">
          <source src={url} type={attachment.mimeType} />
        </audio>
      </div>
    );
  }

  if (attachment.category === "video") {
    return (
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
        <div className="mb-2 flex items-center gap-2">
          <AttachmentIcon category={attachment.category} className="h-4 w-4 text-violet-600 dark:text-violet-300" />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              {attachment.filename}
            </p>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {formatBytes(attachment.sizeBytes)}
            </p>
          </div>
        </div>
        <video controls className="w-full rounded-md bg-black" playsInline>
          <source src={url} type={attachment.mimeType} />
        </video>
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
    rel="noreferrer"
    className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 transition hover:border-violet-500/40 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:bg-zinc-900"
  >
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-300">
      <AttachmentIcon category={attachment.category} className="h-5 w-5" />
    </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          {attachment.filename}
        </p>
        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
          {formatBytes(attachment.sizeBytes)}
        </p>
      </div>
    </a>
  );
}

function attachmentUrl(organizationId: string, attachmentId: string, thumbnail = false): string {
  return `/api/attachments/${encodeURIComponent(attachmentId)}${thumbnail ? "/thumbnail" : ""}?organizationId=${encodeURIComponent(organizationId)}`;
}

function AttachmentIcon({
  category,
  className,
}: {
  category: Attachment["category"];
  className: string;
}) {
  if (category === "image") return <FileImage className={className} />;
  if (category === "document") return <FileText className={className} />;
  if (category === "audio") return <FileAudio className={className} />;
  if (category === "video") return <FileVideo className={className} />;
  if (category === "archive") return <FileArchive className={className} />;
  return <File className={className} />;
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
