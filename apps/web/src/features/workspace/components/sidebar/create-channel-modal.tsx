"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { TextInput } from "@/components/ui/form-fields";
import { Hash } from "lucide-react";
import type { SelectedConversation } from "../../types";

interface CreateChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateChannel: (name: string) => Promise<SelectedConversation | null>;
  onSelect: (created: SelectedConversation) => void;
}

export function CreateChannelModal({
  isOpen,
  onClose,
  onCreateChannel,
  onSelect,
}: CreateChannelModalProps) {
  const [newChannelName, setNewChannelName] = useState("");
  const [isSavingChannel, setIsSavingChannel] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);

  const reset = () => {
    setNewChannelName("");
    setChannelError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Create Channel">
      <div className="space-y-4">
        <div>
          <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 block">
            Channel Name
          </label>
          <div className="group relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
              <Hash className="h-4 w-4" />
            </div>
            <TextInput
              autoFocus
              type="text"
              placeholder="e.g. marketing-plan"
              value={newChannelName}
              onChange={(e) =>
                setNewChannelName(e.target.value.toLowerCase().replace(/\s+/g, "-"))
              }
              className="px-10 py-3 bg-zinc-50 dark:bg-zinc-900/50 dark:focus:bg-black"
            />
          </div>
          <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
            Channels are where your team communicates. They’re best when organized around a topic — #leads, for example.
          </p>
        </div>

        <div className="pt-4 flex justify-end gap-3">
          {channelError ? (
            <p className="mr-auto text-xs text-red-600 dark:text-red-400">{channelError}</p>
          ) : null}
          <button
            onClick={handleClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 transition-colors dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
          <button
            disabled={!newChannelName || isSavingChannel}
            onClick={async () => {
              setChannelError(null);
              setIsSavingChannel(true);
              try {
                const created = await onCreateChannel(newChannelName);
                if (!created) throw new Error("Unable to create channel.");
                handleClose();
                onSelect(created);
              } catch (err) {
                setChannelError(err instanceof Error ? err.message : "Unable to create channel.");
              } finally {
                setIsSavingChannel(false);
              }
            }}
            className="rounded-xl bg-violet-600 px-6 py-2 text-sm font-bold text-white shadow-lg shadow-violet-500/20 hover:bg-violet-700 transition-all disabled:opacity-50 disabled:shadow-none"
          >
            Create Channel
          </button>
        </div>
      </div>
    </Modal>
  );
}
