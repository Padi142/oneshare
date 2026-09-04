import { getAuthUserId } from "@convex-dev/auth/server";

import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import type { Id } from "../_generated/dataModel.js";

type AuthContext = Pick<QueryCtx, "auth"> | Pick<MutationCtx, "auth">;

/** Resolve the active user or fail before any account-scoped data is read. */
export async function requireUserId(ctx: AuthContext): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);

  if (userId === null) {
    throw new Error("Authentication required");
  }

  return userId;
}
