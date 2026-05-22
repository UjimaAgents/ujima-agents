"use client";

export interface ChannelPickerOption {
  id: string;
  name: string;
}

export function ChannelPicker({
  channels,
  selectedIds,
  onChange,
  hint = "Select where this agent can participate.",
}: {
  channels: ChannelPickerOption[];
  selectedIds: string[];
  onChange: (channelIds: string[]) => void;
  hint?: string;
}) {
  const toggle = (channelId: string) => {
    onChange(
      selectedIds.includes(channelId)
        ? selectedIds.filter((id) => id !== channelId)
        : [...selectedIds, channelId],
    );
  };

  return (
    <div>
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Channels</p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      <div className="mt-3 grid gap-2">
        {channels.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Add a channel first.</p>
        ) : (
          channels.map((channel) => (
            <label
              key={channel.id}
              className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(channel.id)}
                onChange={() => toggle(channel.id)}
                className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600"
              />
              <span className="font-medium text-zinc-700 dark:text-zinc-200">{channel.name}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
