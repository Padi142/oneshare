import { FormEvent, useId, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { LoaderIcon } from "../lib/icons";
import { BrandMark } from "./BrandMark";
import { explainAuthFailure } from "../lib/authErrors";
import type { AuthMode } from "../types";

type Feedback = {
  message: string;
  tone: "error" | "notice";
};

export function AuthScreen() {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const emailId = useId();
  const passwordId = useId();
  const isSignIn = mode === "signIn";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setFeedback(undefined);
    setIsSubmitting(true);
    try {
      await signIn("password", {
        email: email.trim(),
        password,
        flow: mode,
      });
    } catch (caught) {
      const failure = explainAuthFailure(caught, mode);
      if (failure.mode) {
        setMode(failure.mode);
        setPassword("");
        setFeedback({ message: failure.message, tone: "notice" });
      } else {
        setFeedback({ message: failure.message, tone: "error" });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <BrandMark size={48} className="auth-mark" />
        <h1 className="auth-title">
          {isSignIn ? "Sign in to OneShare" : "Create your account"}
        </h1>
        <p className="auth-subtitle">
          Send notes, links and files between your own devices.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field-label">Email</span>
            <input
              id={emailId}
              className="text-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
              disabled={isSubmitting}
            />
          </label>

          <label className="field">
            <span className="field-label">Password</span>
            <input
              id={passwordId}
              className="text-input"
              type="password"
              autoComplete={isSignIn ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
              disabled={isSubmitting}
              aria-describedby={isSignIn ? undefined : `${passwordId}-hint`}
            />
            {isSignIn ? null : (
              <span className="field-hint" id={`${passwordId}-hint`}>
                At least 8 characters.
              </span>
            )}
          </label>

          {feedback ? (
            <p
              className={`form-feedback form-feedback--${feedback.tone}`}
              role={feedback.tone === "error" ? "alert" : "status"}
            >
              {feedback.message}
            </p>
          ) : null}

          <button
            className="primary-button auth-submit"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? <LoaderIcon className="spin" size={17} /> : null}
            <span>{isSignIn ? "Sign in" : "Create account"}</span>
          </button>
        </form>

        <p className="auth-switch">
          {isSignIn ? "New to OneShare?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setMode(isSignIn ? "signUp" : "signIn");
              setFeedback(undefined);
            }}
            disabled={isSubmitting}
          >
            {isSignIn ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
    </main>
  );
}
