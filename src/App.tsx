import { ConvexAuthProvider, useConvexAuth } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { OneShareApp } from "./components/OneShareApp";
import { AuthScreen } from "./components/AuthScreen";

const convexUrl = import.meta.env.VITE_CONVEX_URL ?? import.meta.env.CONVEX_URL;
if (!convexUrl) {
  throw new Error(
    "Missing VITE_CONVEX_URL (or CONVEX_URL) in the app environment.",
  );
}
const convex = new ConvexReactClient(convexUrl);

function AuthenticatedApp() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) {
    return (
      <main className="boot-screen">
        <span className="brand-mark brand-mark--large">os</span>
        <span className="boot-line" />
      </main>
    );
  }
  return isAuthenticated ? <OneShareApp /> : <AuthScreen />;
}

export function App() {
  return (
    <ConvexAuthProvider client={convex}>
      <AuthenticatedApp />
    </ConvexAuthProvider>
  );
}
