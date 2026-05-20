import { memo } from "react";

export interface ChatTab {
  id: string;
  label: string;
  count?: number;
  countVariant?: "default" | "warning";
}

export const ChatTabs = memo(function ChatTabs({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: ChatTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
}) {
  return (
    <div className="flex shrink-0 border-b border-zinc-200 px-4 dark:border-zinc-800">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`relative px-3 py-2 text-xs font-medium transition ${
            activeTab === tab.id
              ? "text-violet-600 dark:text-violet-400"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
          }`}
        >
          {tab.label}
          {tab.count != null && (
            <span
              className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                tab.countVariant === "warning"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                  : "text-zinc-400"
              }`}
            >
              {tab.count}
            </span>
          )}
          {activeTab === tab.id && (
            <div className="absolute bottom-0 left-0 h-0.5 w-full bg-violet-600 dark:bg-violet-400" />
          )}
        </button>
      ))}
    </div>
  );
});
