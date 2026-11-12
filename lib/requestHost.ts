import { headers } from "next/headers";
import { isStudioHost } from "./hosts";

/** Whether the current request came in on the Studio host (server components only; makes the route dynamic). */
export async function onStudioHost() {
  return isStudioHost((await headers()).get("host"));
}
