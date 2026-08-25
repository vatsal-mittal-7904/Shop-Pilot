-- Adds AgentAction.conversationId (+ its FK to Conversation), which was present in
-- schema.prisma but had no corresponding migration -- the same drift class as
-- 20260824093000_add_ai_recovered_revenue. Without this, getRecentAgentActions
-- (src/backend/actions/explainability.ts) queries a column the database does not
-- have: `prisma generate` reads schema.prisma, so the client typechecks and the
-- failure only surfaces at runtime.
--
-- Additive and nullable, so existing rows are unaffected. They keep conversationId
-- NULL and are simply not returned by the conversation-scoped fetcher, which is
-- correct -- those rows predate the column and cannot be attributed to a
-- conversation retroactively.
--
-- SET NULL rather than CASCADE deliberately: an AgentAction is an audit record of a
-- policy decision. Deleting a conversation must not erase the evidence that a
-- discount was evaluated and approved or blocked; it only detaches it.
ALTER TABLE "AgentAction" ADD COLUMN "conversationId" TEXT;

ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
