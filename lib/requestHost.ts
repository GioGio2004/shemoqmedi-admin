import { headers } from "next/headers";
import { isDocsHost, isStudioHost } from "./hosts";

/** Whether the current request came in on the Studio host (server components only; makes the route dynamic). */
export async function onStudioHost() {
  return isStudioHost((await headers()).get("host"));
}

/** Whether the current request came in on the team docs host (server components only). */
export async function onDocsHost() {
  return isDocsHost((await headers()).get("host"));
}
