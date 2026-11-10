"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { LogIn, ShieldCheck } from "lucide-react";
import { Page } from "@/components/shell/page";
import { Badge } from "@/components/ui/identity";
import { Button, ButtonLink } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { useAuth } from "@/lib/backend/auth";
import { STATE_COPY } from "@/lib/backend/membership";

export function SignInScreen() {
  const auth = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (auth.membership?.state === "verified") router.replace("/hq");
  }, [auth.membership?.state, router]);
  const state = auth.membership?.state;

  return (
    <Page>
      <div className="mx-auto mt-6 max-w-md rounded-xl border border-edge bg-surface p-8 shadow-card">
        <Badge size={56} className="mx-auto" />
        <h1 className="display mt-5 text-center text-xl font-bold">Sign in to Headquarters</h1>
        <p className="mt-2 text-center text-xs text-muted">
          Sign in with the Discord account listed on the official TPD roster. The site reads your Discord user ID, username and your own TPD server membership (read-only); it cannot post, join servers or act on your behalf.
        </p>

        {auth.status === "disabled" ? (
          <div className="mt-6">
            <Callout tone="warn" title="Sign-in is not configured yet">
              This preview has no backend connected, so Discord sign-in is unavailable. Everything in Headquarters uses labelled demo personas until it is configured.
            </Callout>
            <ButtonLink href="/hq" variant="secondary" className="mt-4 w-full justify-center">
              Continue to the design preview
            </ButtonLink>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            {state && state !== "signed_out" && state !== "verified" ? (
              <Callout tone={state === "unavailable" ? "error" : "warn"} title={STATE_COPY[state].title}>
                {STATE_COPY[state].body}
              </Callout>
            ) : null}
            {auth.error ? (
              <Callout tone="error" title="Something went wrong">
                {auth.error}
              </Callout>
            ) : null}
            {auth.session ? (
              <Button variant="secondary" onClick={auth.signOut} className="w-full justify-center">
                Sign out and use another account
              </Button>
            ) : (
              <Button variant="gold" size="lg" loading={auth.status === "loading"} onClick={auth.signIn} icon={<LogIn />} className="w-full justify-center">
                Sign in with Discord
              </Button>
            )}
            <p className="flex items-start gap-2 text-3xs text-muted">
              <ShieldCheck aria-hidden className="mt-px size-3.5 shrink-0" /> Access comes from your roster record, not from Discord roles or anything set in your browser.
            </p>
          </div>
        )}
        <Link href="/" className="mt-6 block text-center text-2xs font-semibold text-gold-ink hover:underline">
          Back to the public site
        </Link>
      </div>
    </Page>
  );
}

export function AuthCallback() {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const providerError = params.get("error_description") ?? params.get("error");
  useEffect(() => {
    if (providerError || auth.status !== "ready") return;
    router.replace(auth.membership?.state === "verified" ? "/hq" : "/hq/sign-in");
  }, [auth.status, auth.membership?.state, providerError, router]);
  return (
    <Page>
      <div className="mx-auto mt-10 max-w-md text-center">
        {providerError ? (
          <Callout tone="error" title="Discord sign-in did not complete">
            {providerError === "access_denied" ? "Authorization was cancelled in Discord." : "Discord or the sign-in service returned an error. Nothing was changed."}{" "}
            <Link href="/hq/sign-in" className="font-semibold underline">
              Try again
            </Link>
          </Callout>
        ) : auth.status === "disabled" ? (
          <Callout tone="warn" title="Sign-in is not configured" />
        ) : (
          <p className="text-xs text-muted" role="status">
            Completing sign-in and checking the roster…
          </p>
        )}
      </div>
    </Page>
  );
}
