"use client";

import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shows the signed-in user's Convex record: the end-to-end check that
 * Clerk → Convex auth and the Clerk webhook user sync both work.
 */
export function CurrentUserCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Convex user record</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <AuthLoading>
          <p className="text-muted-foreground">Loading…</p>
        </AuthLoading>
        <Unauthenticated>
          <p className="text-destructive">
            Signed in to Clerk, but Convex did not accept the token. Check the
            Clerk JWT template &quot;convex&quot; and CLERK_FRONTEND_API_URL on the
            Convex deployment.
          </p>
        </Unauthenticated>
        <Authenticated>
          <UserRecord />
        </Authenticated>
      </CardContent>
    </Card>
  );
}

function UserRecord() {
  const user = useQuery(api.users.getCurrentUser);

  if (user === undefined) {
    return <p className="text-muted-foreground">Loading…</p>;
  }
  if (user === null) {
    return (
      <p className="text-muted-foreground">
        No Convex record yet. The Clerk webhook creates it a few seconds after sign-up.
      </p>
    );
  }

  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-y-2">
      <dt className="text-muted-foreground">Name</dt>
      <dd>{user.name}</dd>
      <dt className="text-muted-foreground">Email</dt>
      <dd>{user.email}</dd>
      <dt className="text-muted-foreground">Role</dt>
      <dd>{user.role ?? "—"}</dd>
      <dt className="text-muted-foreground">Convex id</dt>
      <dd className="font-mono text-xs">{user._id}</dd>
    </dl>
  );
}
