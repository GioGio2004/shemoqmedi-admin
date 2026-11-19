import { beforeAll, describe, expect, it } from "vitest";
import { presignPut } from "../convex/lib/r2";

// Audit C-08: a browser's presigned video URL must only accept the type and
// size the server checked (R2 answers 403 to anything else).

beforeAll(() => {
  Object.assign(process.env, {
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET: "bucket",
    R2_PUBLIC_URL: "https://media.example",
  });
});

describe("presignPut", () => {
  it("signs Content-Type and Content-Length when bound", async () => {
    const url = new URL(await presignPut("listings/a/a.mp4", 900, { contentType: "video/mp4", size: 1234 }));
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
  });

  it("leaves server-side uploads unbound", async () => {
    const url = new URL(await presignPut("social/a/a.mp3"));
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });
});
