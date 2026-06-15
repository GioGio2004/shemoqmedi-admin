import { mutation } from "./_generated/server";

export const removeExpiredSessions = mutation({
  handler: async (ctx) => {
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
    
    // Query sessions older than 24 hours
    // Alternatively, we could use q.lt(q.field("expiresAt"), Date.now()) if we wanted 7 days,
    // but the strict 24-hour retention requirement takes precedence.
    const expiredSessions = await ctx.db
      .query("chatSessions")
      .filter((q) => q.lt(q.field("createdAt"), twentyFourHoursAgo))
      .collect();

    for (const session of expiredSessions) {
      // 1. Cascading deletion: find and delete all messages associated with this session
      const messages = await ctx.db
        .query("chatMessages")
        .withIndex("bySession", (q) => 
          q.eq("sessionId", session.sessionId).eq("cafeId", session.cafeId)
        )
        .collect();

      for (const msg of messages) {
        await ctx.db.delete(msg._id);
      }

      // 2. Delete the session itself
      await ctx.db.delete(session._id);
    }
  },
});
