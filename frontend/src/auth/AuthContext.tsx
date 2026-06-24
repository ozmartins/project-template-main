import type { Session, User } from "@supabase/supabase-js";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/data/supabase";
import type { AppRole, UserProfile } from "./types";
import { canAdminister, canReview, canWrite } from "./types";

/** Authenticator Assurance Level reported by GoTrue. */
export type AssuranceLevel = "aal1" | "aal2" | null;

export interface AuthContextValue {
  /** Current session (null = unauthenticated / loading). */
  session: Session | null;
  /** Resolved user profile, or null when not signed in. */
  profile: UserProfile | null;
  /** True while the initial session is being resolved. */
  isLoading: boolean;
  /** The session's current authenticator assurance level (aal1 / aal2). */
  aal: AssuranceLevel;
  /**
   * True when the session must step up to a higher assurance level before app
   * content may be shown (no verified TOTP factor, or aal1 → aal2 step-up
   * pending).
   */
  mfaRequired: boolean;
  /** Re-read the assurance level from GoTrue (call after verifying a factor). */
  refreshAal(): Promise<void>;
  /** Sign in with email + password; throws on failure. */
  signIn(email: string, password: string): Promise<void>;
  /** Sign out the current user. */
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function profileFromUser(user: User): UserProfile {
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
  const userMeta = (user.user_metadata ?? {}) as Record<string, string>;
  return {
    id: user.id,
    email: user.email ?? "",
    displayName: userMeta.display_name || (user.email ? user.email.split("@")[0] : "User"),
    role: (meta.role as AppRole) ?? "read_only",
    tenant: typeof meta.tenant === "string" ? meta.tenant : "default",
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [aal, setAal] = useState<AssuranceLevel>(null);
  const [mfaRequired, setMfaRequired] = useState(false);

  const handleSession = useCallback((s: Session | null) => {
    setSession(s);
    setProfile(s?.user ? profileFromUser(s.user) : null);
  }, []);

  const refreshAal = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) {
      setAal(null);
      setMfaRequired(false);
      return;
    }
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) {
      setAal(null);
      setMfaRequired(false);
      return;
    }
    setAal((data.currentLevel as AssuranceLevel) ?? null);
    // MFA is mandatory: require it if the user has no verified TOTP factor
    // (forces first-time enrollment) OR if a step-up (aal1→aal2) is pending.
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const hasVerifiedTotp = (factors?.totp ?? []).some((f) => f.status === "verified");
    const stepUpNeeded = data.nextLevel != null && data.currentLevel !== data.nextLevel;
    setMfaRequired(!hasVerifiedTotp || stepUpNeeded);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      handleSession(data.session);
      if (data.session) await refreshAal();
      setIsLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      handleSession(s);
      void refreshAal();
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [handleSession, refreshAal]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.session) {
        throw new Error("Unexpected response: sign-in succeeded but no session was returned.");
      }
      handleSession(data.session);
      await refreshAal();
    },
    [handleSession, refreshAal]
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setAal(null);
    setMfaRequired(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{ session, profile, isLoading, aal, mfaRequired, refreshAal, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** Consume the auth context. Must be used inside <AuthProvider>. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return ctx;
}

/** Auth capabilities for a user profile. */
export interface AuthCapabilities {
  canWrite: boolean;
  canReview: boolean;
  canAdminister: boolean;
  role: AppRole | undefined;
}

/**
 * Returns the current user's auth capabilities. Defaults to the most
 * restrictive set when no session is available. Reference is stable as long as
 * the user's role does not change.
 */
export function useAuthCapabilities(): AuthCapabilities {
  const ctx = useContext(AuthContext);
  const role = ctx?.profile?.role;
  return useMemo<AuthCapabilities>(
    () => ({
      canWrite: canWrite(role),
      canReview: canReview(role),
      canAdminister: canAdminister(role),
      role,
    }),
    [role]
  );
}
