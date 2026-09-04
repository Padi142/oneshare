import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

/**
 * Email/password authentication for all OneShare clients.
 *
 * Convex Auth owns the session and account tables; application functions use
 * `getAuthUserId` to scope every read and write to the active account.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});
