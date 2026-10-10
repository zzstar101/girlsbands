// Cron-style schedules (Asia/Shanghai). Each run is recorded in job_runs; missed slots run once.
import type { PgBoss } from "pg-boss";
import { ensureQueue, recordRun } from "@girlsbands/backend/jobs/queue";
import { sweepUnprocessed } from "@girlsbands/backend/jobs/content";
import { translatePending } from "@girlsbands/backend/editorial/translate";
import { adaptIntervals, scheduleDueSources } from "@girlsbands/backend/sources/collect";
import { scheduleMpReconcile } from "@girlsbands/backend/sources/mp";
import { refreshSourceIcons } from "@girlsbands/backend/sources/icons";
import { computeHotRanking, snapshotHeat } from "@girlsbands/backend/events/hot";
import { linkRelatedStories } from "@girlsbands/backend/events/consolidate";
import { sweepSetlists } from "@girlsbands/backend/lives/setlists";
import { composeDueReports } from "@girlsbands/backend/reports/compose";
import { dailyRetention } from "@girlsbands/backend/operations/retention";
import { submitIndexNow } from "@girlsbands/backend/operations/indexnow";
import { checkAlerts, sendDigest } from "@girlsbands/backend/operations/alerts";
import { recoverStaleWork } from "@girlsbands/backend/operations/recover";
import { forwardPendingFeedback } from "@girlsbands/backend/operations/feedback";
import { sendDeadlineReminders, sendDigest as sendSubscriberDigest } from "@girlsbands/backend/subscriptions/notify";
import { backupConfigured, runBackup } from "@girlsbands/backend/operations/backup";
import { sourceHealthWeekly } from "@girlsbands/backend/operations/reports";
import { prunePageViews, pullEdgeOne } from "@girlsbands/backend/operations/edgeanalytics";
import { pullGcore } from "@girlsbands/backend/operations/gcoreanalytics";

interface Scheduled {
  name: string;
  cron: string;
  run: () => Promise<unknown>;
  missed?: "skip" | "once";
}

const collecting = process.env.COLLECT_ENABLED === "true";

export const SCHEDULES: Scheduled[] = [
  { name: "content.sweep", cron: "*/5 * * * *", run: sweepUnprocessed },
  // Full-text translations of newly selected items (model calls; off with MODEL_CALLS_ENABLED=false).
  { name: "content.translate", cron: "*/5 * * * *", run: () => translatePending() },
  { name: "hot.rank", cron: "*/5 * * * *", run: () => computeHotRanking() },
  { name: "hot.snapshot", cron: "2 * * * *", run: () => snapshotHeat() },
  { name: "stories.links", cron: "12 * * * *", run: linkRelatedStories },
  // 散场之后的曲目单：一小时一轮，只对已经结束、还没问过原文的演出跑（模型调用，见 MODEL_CALLS_ENABLED）。
  { name: "lives.setlist", cron: "23 * * * *", missed: "once", run: () => sweepSetlists() },
  // Every issue that is due and not written yet: a daily from 08:00, a weekly from Monday 10:00, a monthly
  // from the 1st 10:30, each on the half hour it falls due; a missed or failed one at the next run.
  { name: "reports.compose", cron: "0,30 * * * *", missed: "once", run: () => composeDueReports() },
  { name: "ops.retention", cron: "30 3 * * *", missed: "once", run: () => dailyRetention() },
  { name: "sources.icons", cron: "40 4 * * *", missed: "once", run: () => refreshSourceIcons() },
  // IndexNow for new indexable pages (off unless INDEXNOW_SUBMIT_ENABLED).
  { name: "seo.indexnow", cron: "50 5 * * *", missed: "once", run: () => submitIndexNow() },
  // Work a stopped process left half way becomes visible, and unknown paid requests get their one
  // automatic release; ops.alerts runs in parallel and sees the result by its next run at the latest.
  { name: "ops.recover", cron: "*/10 * * * *", run: () => recoverStaleWork() },
  { name: "ops.alerts", cron: "*/10 * * * *", run: () => checkAlerts() },
  // One message with other follow-ups and their actual impact (nothing when there are none).
  { name: "ops.digest", cron: "0 9 * * *", missed: "once", run: () => sendDigest() },
  // Feedback that did not reach the internal Feishu chat when it was sent (off with FEISHU_INTERNAL_ENABLED).
  { name: "feedback.forward", cron: "*/10 * * * *", run: () => forwardPendingFeedback() },
  // Reader mail (off with EMAIL_ENABLED; each run says why it sent nothing). The reminder only goes out
  // when something is inside 48 hours, so two runs a day is about catching ballots before they close.
  { name: "email.deadline", cron: "0 9,21 * * *", missed: "once", run: () => sendDeadlineReminders() },
  { name: "email.digest", cron: "0 20 * * *", missed: "once", run: () => sendSubscriberDigest() },
  ...(backupConfigured() ? [{ name: "ops.backup", cron: "10 4 * * *", missed: "once" as const, run: () => runBackup() }] : []),
  { name: "reports.source-health", cron: "0 9 * * 1", missed: "once", run: () => sourceHealthWeekly() },
  // The site's two outside counts: the pages at Gcore's edge, the static files and images at EdgeOne's.
  { name: "analytics.edgeone", cron: "0 * * * *", missed: "once", run: () => pullEdgeOne(3) },
  { name: "analytics.gcore", cron: "5 * * * *", missed: "once", run: () => pullGcore(3) },
  { name: "analytics.page-view-retention", cron: "20 3 * * *", missed: "once", run: () => prunePageViews() },
  ...(collecting
    ? [
        { name: "sources.schedule", cron: "* * * * *", run: () => scheduleDueSources() },
        { name: "sources.adapt-intervals", cron: "20 4 * * *", run: adaptIntervals },
        // WeChat official accounts (paid), each once per its interval.
        { name: "sources.mp-reconcile", cron: "*/15 * * * *", run: () => scheduleMpReconcile() },
      ]
    : []),
];

export async function registerSchedules(boss: PgBoss) {
  for (const s of SCHEDULES) {
    const queue = `cron.${s.name}`;
    await ensureQueue(queue, { policy: "singleton", retryLimit: 1, expireInSeconds: 3600 });
    await boss.schedule(queue, s.cron, {}, { tz: "Asia/Shanghai", missed: s.missed ?? "skip" });
    // Schedules fire at minute boundaries; a 15 s pickup keeps them on time with a third of the polling.
    await boss.work(queue, { pollingIntervalSeconds: 15 }, async () => recordRun(s.name, s.run));
  }
  // pg-boss keeps a schedule until it is unscheduled: one dropped from this list (or switched off) would go
  // on queueing jobs nobody works.
  const current = new Set(SCHEDULES.map((s) => `cron.${s.name}`));
  for (const old of await boss.getSchedules()) {
    if (old.name.startsWith("cron.") && !current.has(old.name)) await boss.unschedule(old.name, old.key);
  }
}
