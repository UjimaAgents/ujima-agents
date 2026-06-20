"use client";

import { useCallback, useEffect, useRef, useState, memo } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { SettingsErrorAlert, SettingsLoading } from "@/features/settings/shared/settings-alert";
import {
  SettingsSecondaryButton,
} from "@/features/settings/shared/settings-buttons";
import { SettingsEmptyState } from "@/features/settings/shared/settings-empty-state";
import { SettingsList, SettingsListRow, SettingsRowIcon } from "@/features/settings/shared/settings-list-row";
import { SettingsTabActions } from "@/features/settings/shared/settings-layout";

interface SelfImprovementReview {
  id: string;
  runId: string;
  memberId: string;
  triggerType: "heartbeat" | "post_turn" | "manual";
  summary: string;
  memoryWrites: number;
  procedureWrites: number;
  createdAt: string;
  updatedAt: string;
}

function formatDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function triggerLabel(type: SelfImprovementReview["triggerType"]): string {
  switch (type) {
    case "heartbeat": return "Heartbeat";
    case "post_turn": return "Post-Turn";
    case "manual": return "Manual";
  }
}

export const SelfImprovementTab = memo(function SelfImprovementTab() {
  const [reviews, setReviews] = useState<SelfImprovementReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/self-improvement/reviews");
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Unable to fetch reviews");
      }
      const data = await res.json();
      setReviews(data.reviews ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reviews");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetched = useRef(false);
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    void fetchReviews();
  }, [fetchReviews]);

  if (loading) return <SettingsLoading />;

  return (
    <div>
      <SettingsTabActions>
        <SettingsSecondaryButton onClick={() => void fetchReviews()} disabled={loading}>
          <RefreshCw className="w-4 h-4" />
          Refresh
        </SettingsSecondaryButton>
      </SettingsTabActions>

      {error && <SettingsErrorAlert message={error} onDismiss={() => setError(null)} />}

      {reviews.length === 0 && !error ? (
        <SettingsEmptyState
          icon={Sparkles}
          title="No self-improvement reviews yet"
          description="Self-improvement reviews are automatically created after heartbeat or post-turn runs. They record what your agents learned and changed."
        />
      ) : (
        <SettingsList>
          {reviews.map((review) => (
            <SettingsListRow
              key={review.id}
              leading={<SettingsRowIcon icon={Sparkles} />}
              primary={
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                      {triggerLabel(review.triggerType)}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDate(review.createdAt)}</span>
                  </div>
                  <div className="text-sm mt-1 line-clamp-2">{review.summary || "No summary"}</div>
                  <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                    <span>Memory writes: {review.memoryWrites}</span>
                    <span>Procedure writes: {review.procedureWrites}</span>
                  </div>
                </div>
              }
            />
          ))}
        </SettingsList>
      )}
    </div>
  );
});
