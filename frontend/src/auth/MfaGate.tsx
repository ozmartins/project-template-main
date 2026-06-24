/**
 * MfaGate — enforces a verified TOTP factor (assurance level aal2) AFTER the
 * password gate.
 *
 * Decision flow (driven by AuthContext.mfaRequired):
 *   - mfaRequired === false → session satisfies required assurance level → render app.
 *   - mfaRequired === true  → step-up is needed:
 *       * a verified TOTP factor exists → CHALLENGE the existing factor.
 *       * no verified TOTP factor       → ENROLL a new one (QR + verify).
 *
 * On successful verify the session is promoted to aal2; refreshAal() re-renders the app.
 * See ADR-0034.
 */

import { Loader2, LogOut, ShieldAlert, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/data/supabase";
import { useAuth } from "./AuthContext";

function MfaShell({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const { signOut, profile } = useAuth();
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground"
      data-testid="mfa-card"
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              {icon}
            </span>
            <div className="flex flex-col leading-tight">
              <CardTitle className="text-base font-semibold tracking-tight">{title}</CardTitle>
            </div>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {children}
          <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
            <span className="truncate">{profile?.email}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void signOut()}
              data-testid="mfa-sign-out"
            >
              <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CodeForm({
  onSubmit,
  isLoading,
  error,
  submitLabel,
}: {
  onSubmit: (code: string) => void;
  isLoading: boolean;
  error: string | null;
  submitLabel: string;
}) {
  const [code, setCode] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(code);
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="mfa-code">Authentication code</Label>
        <Input
          id="mfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          required
          disabled={isLoading}
          autoFocus
          data-testid="mfa-code"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="mfa-error">
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={isLoading || code.length !== 6}
        data-testid="mfa-submit"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Verifying…
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </form>
  );
}

interface EnrollState {
  factorId: string;
  qrCode: string;
  secret: string;
  uri: string;
}

function EnrollScreen({ onVerified }: { onVerified: () => void }) {
  const [enroll, setEnroll] = useState<EnrollState | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  // Guard against React 18 StrictMode double-invoke creating two factors.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      // Clean up any leftover unverified TOTP factors so re-enrollment does
      // not fail with "factor already exists".
      const { data: list } = await supabase.auth.mfa.listFactors();
      const stale = (list?.totp ?? []).filter((f) => f.status !== "verified");
      for (const f of stale) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }

      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error || !data) {
        setSetupError(error?.message ?? "Unable to start MFA enrollment.");
        return;
      }
      setEnroll({
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
        uri: data.totp.uri,
      });
    })();
  }, []);

  const handleVerify = useCallback(
    async (code: string) => {
      if (!enroll) return;
      setVerifyError(null);
      setIsVerifying(true);
      try {
        const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
          factorId: enroll.factorId,
        });
        if (challengeError || !challenge) {
          throw challengeError ?? new Error("Could not create MFA challenge.");
        }
        const { error: verifyError } = await supabase.auth.mfa.verify({
          factorId: enroll.factorId,
          challengeId: challenge.id,
          code,
        });
        if (verifyError) throw verifyError;
        onVerified();
      } catch (err: unknown) {
        setVerifyError(err instanceof Error ? err.message : "Invalid code. Please try again.");
        setIsVerifying(false);
      }
    },
    [enroll, onVerified]
  );

  if (setupError) {
    return (
      <MfaShell
        title="Set up two-factor authentication"
        description="We could not start enrollment."
        icon={<ShieldAlert className="h-5 w-5" />}
      >
        <p role="alert" className="text-sm text-destructive" data-testid="mfa-error">
          {setupError}
        </p>
      </MfaShell>
    );
  }

  if (!enroll) {
    return (
      <MfaShell
        title="Set up two-factor authentication"
        description="Preparing your authenticator setup…"
        icon={<ShieldCheck className="h-5 w-5" />}
      >
        <div className="flex justify-center py-6 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
        </div>
      </MfaShell>
    );
  }

  return (
    <MfaShell
      title="Set up two-factor authentication"
      description="Scan the QR code with an authenticator app (Google Authenticator, 1Password, Authy…), then enter the 6-digit code to finish."
      icon={<ShieldCheck className="h-5 w-5" />}
    >
      <div className="flex justify-center">
        <img
          src={enroll.qrCode}
          alt="TOTP QR code"
          className="h-44 w-44 rounded-md border border-border/70 bg-white p-2"
          data-testid="mfa-qr"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          Can&apos;t scan? Enter this secret manually:
        </Label>
        <code
          className="block break-all rounded-md bg-muted px-3 py-2 text-center text-sm font-mono"
          data-testid="mfa-secret"
        >
          {enroll.secret}
        </code>
      </div>
      <CodeForm
        onSubmit={handleVerify}
        isLoading={isVerifying}
        error={verifyError}
        submitLabel="Verify & enable"
      />
    </MfaShell>
  );
}

function ChallengeScreen({ factorId, onVerified }: { factorId: string; onVerified: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const handleVerify = useCallback(
    async (code: string) => {
      setError(null);
      setIsVerifying(true);
      try {
        const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
          factorId,
        });
        if (challengeError || !challenge) {
          throw challengeError ?? new Error("Could not create MFA challenge.");
        }
        const { error: verifyError } = await supabase.auth.mfa.verify({
          factorId,
          challengeId: challenge.id,
          code,
        });
        if (verifyError) throw verifyError;
        onVerified();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Invalid code. Please try again.");
        setIsVerifying(false);
      }
    },
    [factorId, onVerified]
  );

  return (
    <MfaShell
      title="Two-factor authentication"
      description="Enter the 6-digit code from your authenticator app to continue."
      icon={<ShieldCheck className="h-5 w-5" />}
    >
      <CodeForm
        onSubmit={handleVerify}
        isLoading={isVerifying}
        error={error}
        submitLabel="Verify"
      />
    </MfaShell>
  );
}

export function MfaGate({ children }: { children: React.ReactNode }) {
  const { mfaRequired, refreshAal } = useAuth();
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    if (!mfaRequired) return;
    let cancelled = false;
    setResolving(true);
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;
      const verified =
        (data?.totp ?? []).find((f) => f.status === "verified") ??
        (data?.all ?? []).find((f) => f.factor_type === "totp" && f.status === "verified");
      setVerifiedFactorId(verified ? verified.id : "");
      setResolving(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [mfaRequired]);

  if (!mfaRequired) {
    return <>{children}</>;
  }

  if (resolving) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background text-muted-foreground"
        data-testid="mfa-loading"
      >
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  const handleVerified = () => {
    void refreshAal();
  };

  if (verifiedFactorId) {
    return <ChallengeScreen factorId={verifiedFactorId} onVerified={handleVerified} />;
  }
  return <EnrollScreen onVerified={handleVerified} />;
}
