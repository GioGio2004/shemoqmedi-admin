"use client";

import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shows the signed-in user's Convex record: the end-to-end check that
 * Clerk → Convex auth and the Clerk webhook user sync both work.
 */
export function CurrentUserCard() {
  const t = useTranslations("dashboard");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("convexRecord")}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <AuthLoading>
          <p className="text-muted-foreground">{t("loading")}</p>
        </AuthLoading>
        <Unauthenticated>
          <p className="text-destructive">{t("convexUnauthenticated")}</p>
        </Unauthenticated>
        <Authenticated>
          <UserRecord />
        </Authenticated>
      </CardContent>
    </Card>
  );
}

function UserRecord() {
  const t = useTranslations("dashboard");
  const user = useQuery(api.users.getCurrentUser);

  if (user === undefined) {
    return <p className="text-muted-foreground">{t("loading")}</p>;
  }
  if (user === null) {
    return <p className="text-muted-foreground">{t("notSynced")}</p>;
  }

  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-y-2">
      <dt className="text-muted-foreground">{t("name")}</dt>
      <dd>{user.name}</dd>
      <dt className="text-muted-foreground">{t("email")}</dt>
      <dd>{user.email}</dd>
      <dt className="text-muted-foreground">{t("role")}</dt>
      <dd>{user.role ?? "—"}</dd>
      <dt className="text-muted-foreground">Convex id</dt>
      <dd className="font-mono text-xs">{user._id}</dd>
    </dl>
  );
}
