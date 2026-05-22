"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export function useSettingsTab<T extends string>(
  validTabs: readonly T[],
  defaultTab: T,
  basePath = "/settings/organization",
) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeTab = useMemo(() => {
    const tabParam = searchParams?.get("tab");
    if (tabParam && (validTabs as readonly string[]).includes(tabParam)) {
      return tabParam as T;
    }
    return defaultTab;
  }, [searchParams, validTabs, defaultTab]);

  const setActiveTab = useCallback(
    (tab: T) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("tab", tab);
      router.replace(`${basePath}?${params.toString()}`, { scroll: false });
    },
    [router, searchParams, basePath],
  );

  return { activeTab, setActiveTab };
}
