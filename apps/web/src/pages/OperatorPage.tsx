import type { FeedbackPage, FeedbackStatus, OperatorOverview } from "@picks/shared";
import { useState } from "react";
import { api, messageOf, unwrap } from "../api";
import { OperatorDashboard } from "../components/OperatorDashboard";
import { Button } from "../components/ui/button";
import { Notice } from "../components/ui/card";
import { notifyDone, notifyError } from "../notify";
import { useLoad } from "./useLoad";

/** App-wide numbers and the feedback inbox. The API answers 404 to anyone who isn't an operator. */
export function OperatorPage() {
  const overview = useLoad(() => unwrap<OperatorOverview>(api.operator.overview.$get()), "overview");
  const feedback = useLoad(() => unwrap<FeedbackPage>(api.operator.feedback.$get({ query: {} })), "feedback");
  const [savingId, setSavingId] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  async function setStatus(id: string, status: FeedbackStatus) {
    setSavingId(id);
    try {
      await unwrap(
        api.operator.feedback[":feedbackId"].$put({ param: { feedbackId: id }, json: { status } }),
      );
      feedback.setData(
        (page) =>
          page && { ...page, items: page.items.map((item) => (item.id === id ? { ...item, status } : item)) },
      );
      overview.setData(
        (data) => data && { ...data, openFeedback: data.openFeedback + (status === "done" ? -1 : 1) },
      );
      notifyDone(status === "done" ? "Marked done." : "Reopened.");
    } catch (err) {
      notifyError(messageOf(err));
    } finally {
      setSavingId(undefined);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const [nextOverview, nextFeedback] = await Promise.all([
        unwrap<OperatorOverview>(api.operator.overview.$get()),
        unwrap<FeedbackPage>(api.operator.feedback.$get({ query: {} })),
      ]);
      overview.setData(nextOverview);
      feedback.setData(nextFeedback);
    } catch (err) {
      notifyError(messageOf(err));
    } finally {
      setRefreshing(false);
    }
  }

  async function loadMore() {
    if (!feedback.data?.nextCursor) return;
    setLoadingMore(true);
    try {
      const next = await unwrap<FeedbackPage>(
        api.operator.feedback.$get({ query: { before: feedback.data.nextCursor } }),
      );
      feedback.setData(
        (page) => page && { items: [...page.items, ...next.items], nextCursor: next.nextCursor },
      );
    } catch (err) {
      notifyError(messageOf(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const error = overview.data && feedback.data ? undefined : (overview.error ?? feedback.error);
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-4xl leading-none font-extrabold">Operator</h2>
        <Button variant="outline" disabled={refreshing || loadingMore || !!savingId} onClick={refresh}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {error && <Notice kind="alert">{error}</Notice>}
      {!error && !(overview.data && feedback.data) && <p className="text-muted-foreground">Loading…</p>}
      {overview.data && feedback.data && (
        <>
          <p className="m-0 text-muted-foreground">
            Everything in the app, across every league. As of{" "}
            {new Date(overview.data.generatedAt).toLocaleString()}.
          </p>
          <OperatorDashboard
            overview={overview.data}
            feedback={feedback.data.items}
            savingId={savingId}
            busy={refreshing || loadingMore || !!savingId}
            loadingMore={loadingMore}
            onLoadMore={feedback.data.nextCursor ? loadMore : undefined}
            onSetStatus={setStatus}
          />
        </>
      )}
    </div>
  );
}
