import type { AuthMode } from "../types";

export interface AuthFailure {
  message: string;
  mode?: AuthMode;
}

/**
 * Converts Convex Auth implementation details into the next useful action for
 * the person signing in. Server messages must never be rendered verbatim.
 */
export function explainAuthFailure(
  error: unknown,
  attemptedMode: AuthMode,
): AuthFailure {
  const detail = error instanceof Error ? error.message : "";

  if (attemptedMode === "signIn" && detail.includes("InvalidAccountId")) {
    return {
      message:
        "There is no relay for this email yet. Create one to get started.",
      mode: "signUp",
    };
  }

  if (attemptedMode === "signUp" && /Account .+ already exists/.test(detail)) {
    return {
      message: "This email already has a relay. Sign in to continue.",
      mode: "signIn",
    };
  }

  if (detail.includes("InvalidSecret")) {
    return { message: "That password does not match this relay." };
  }

  if (detail.includes("TooManyFailedAttempts")) {
    return {
      message: "Too many attempts. Please wait a moment and try again.",
    };
  }

  return { message: "We couldn't complete that request. Please try again." };
}
