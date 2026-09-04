import { FormEvent, useId, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { ArrowLeftIcon, ArrowDownIcon, LoaderIcon } from "../lib/icons";
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
      <section className="auth-intro" aria-labelledby="auth-title">
        <div className="auth-intro-topline">
          <span className="brand-mark brand-mark--large" aria-hidden="true">
            os
          </span>
          <span className="eyebrow">ONE / SHARE</span>
        </div>
        <div className="auth-intro-copy">
          <p className="kicker">Your personal relay</p>
          <h1 id="auth-title">
            Keep the useful
            <br />
            <em>things</em> close.
          </h1>
          <p className="auth-description">
            A quiet place for the links, notes and files that move with you.
          </p>
        </div>
        <div className="auth-intro-footer" aria-hidden="true">
          <span>01</span>
          <span className="auth-rule" />
          <span>Private by default</span>
        </div>
      </section>

      <section
        className="auth-panel"
        aria-label={isSignIn ? "Sign in" : "Create account"}
      >
        <div className="auth-panel-inner">
          <div className="auth-panel-heading">
            <span className="eyebrow">
              {isSignIn ? "Welcome back" : "First visit"}
            </span>
            <h2>{isSignIn ? "Sign in to your relay" : "Make your relay"}</h2>
            <p>
              {isSignIn
                ? "Pick up where you left off."
                : "One account, every device."}
            </p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="field-label" htmlFor={emailId}>
              Email
            </label>
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

            <label className="field-label" htmlFor={passwordId}>
              Password
            </label>
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
            />

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
              <span>{isSignIn ? "Enter relay" : "Create relay"}</span>
              {isSubmitting ? (
                <LoaderIcon className="spin" size={17} />
              ) : (
                <ArrowDownIcon size={17} />
              )}
            </button>
          </form>

          <div className="auth-switch">
            <span>{isSignIn ? "New here?" : "Already have a relay?"}</span>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setMode(isSignIn ? "signUp" : "signIn");
                setFeedback(undefined);
              }}
              disabled={isSubmitting}
            >
              {isSignIn ? "Create an account" : "Sign in"}
              <ArrowLeftIcon size={14} />
            </button>
          </div>
        </div>
        <p className="auth-panel-note">
          <span className="status-dot" /> Synced across your signed-in devices
        </p>
      </section>
    </main>
  );
}
