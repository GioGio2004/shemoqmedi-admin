import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionArgs } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/** The queue's status argument (undefined is the waiting tab). */
type Tab = FunctionArgs<typeof api.social.queue>["status"];

/**
 * Takes a post off every loaded queue tab except `keep` the moment an action
 * is sent (a published post leaves Waiting, a rejected one every tab but
 * Rejected and All). The server's answer replaces this, or rolls it back if
 * the action fails.
 */
export function dropFromQueues(store: OptimisticLocalStore, id: Id<"socialPosts">, keep: Tab[]) {
  const loaded = store.getAllQueries(api.social.queue);
  const wasWaiting = loaded.some(({ value }) => value?.some((p) => p.id === id && p.status === "waiting"));
  for (const { args, value } of loaded) {
    if (!value) continue;
    if (keep.includes(args.status ?? "waiting")) continue;
    store.setQuery(
      api.social.queue,
      args,
      value.filter((p) => p.id !== id),
    );
  }
  const waiting = store.getQuery(api.social.waitingCount, {});
  if (wasWaiting && typeof waiting === "number" && !keep.includes("waiting")) {
    store.setQuery(api.social.waitingCount, {}, Math.max(0, waiting - 1));
  }
}
