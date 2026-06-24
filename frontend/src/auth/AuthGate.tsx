/**
 * AuthGate — requires authentication before rendering the application.
 *
 * While the initial session resolves, a loading screen is shown. When there is
 * no session, a full-screen sign-in form is rendered instead of the app. Once
 * a session exists, MfaGate enforces the aal2 TOTP step-up before children
 * (the router) are shown. See ADR-0034.
 */

import { Loader2, LogIn, Shield } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "./AuthContext";
import { MfaGate } from "./MfaGate";

function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await signIn(email, password);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Sign-in failed. Please check your credentials."
      );
      setIsLoading(false);
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground"
      data-testid="login-card"
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Shield className="h-5 w-5" />
          </span>
          <div className="flex flex-col leading-tight">
            <h1 className="text-base font-semibold tracking-tight">Application</h1>
            <span className="text-xs text-muted-foreground">Sign in to continue</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
              data-testid="login-email"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="login-password">Password</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
              data-testid="login-password"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive" data-testid="login-error">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isLoading} data-testid="login-submit">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Signing in…
              </>
            ) : (
              <>
                <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
                Sign In
              </>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background text-muted-foreground"
        data-testid="auth-loading"
      >
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  return <MfaGate>{children}</MfaGate>;
}
