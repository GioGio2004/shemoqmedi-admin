import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { createHmac } from "node:crypto";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { safeSegment, signUploadParams, uploadChecks } from "../convex/lib/imagekitSign";
import { listingUploadTarget } from "../convex/media";

// Audit C-02: the browser used to get a bare v1 signature and could upload any
// file, anywhere in the ImageKit account, under any name. Now the server signs
// the upload's parameters into a v2 JWT.

const modules = import.meta.glob("../convex/**/*.ts");
const keys = { privateKey: "private_test", publicKey: "public_test" };

function decode(part: string) {
  return JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
}

describe("signed v2 uploads", () => {
  it("puts the exact form fields in an HS256 JWT signed with the private key", async () => {
    const now = 1_800_000_000_000;
    const { token, params } = await signUploadParams(
      { fileName: "a.webp", folder: "/listings/a", tags: "listing", checks: uploadChecks(5 * 1024 * 1024, ["image/webp"]) },
      keys,
      now,
    );
    const [h, p, sig] = token.split(".");
    expect(decode(h)).toEqual({ alg: "HS256", typ: "JWT", kid: "public_test" });
    const payload = decode(p);
    expect(payload).toMatchObject({ ...params, iat: now / 1000, exp: now / 1000 + 600 });
    expect(params).toMatchObject({ useUniqueFileName: "true", overwriteFile: "false" });
    const expected = createHmac("sha256", keys.privateKey).update(`${h}.${p}`).digest("base64url");
    expect(sig).toBe(expected);
  });

  it("states the size and type limits as an ImageKit check", () => {
    expect(uploadChecks(5 * 1024 * 1024, ["image/webp", "image/png"])).toBe(
      '"file.size" <= "5mb" AND "file.mime" IN ["image/webp", "image/png"]',
    );
  });

  it("never lets a name escape its folder", () => {
    expect(safeSegment("../../social/graphics", "x")).toBe("social-graphics");
    expect(safeSegment("   ", "site")).toBe("site");
    expect(listingUploadTarget("Kencho Group!", "Screenshot 2", "image/webp")).toEqual({
      fileName: "kencho-group-website-screenshot-2.webp",
      folder: "/listings/kencho-group",
      tags: "listing,kencho-group,image",
    });
    expect(() => listingUploadTarget("a", "b", "text/html")).toThrow();
  });

  it("only signs for signed-in people, into /listings", async () => {
    process.env.IMAGEKIT_PRIVATE_KEY = keys.privateKey;
    process.env.IMAGEKIT_PUBLIC_KEY = keys.publicKey;
    process.env.IMAGEKIT_URL_ENDPOINT = "https://ik.imagekit.io/test";
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("users", { externalId: "user_1", name: "U", email: "u@example.com", createdAt: 0, updatedAt: 0 }),
    );
    const args = { site: "Slash", label: "cover", contentType: "image/png" };
    await expect(t.action(api.media.uploadAuth, args)).rejects.toThrow(/log in/);
    const auth = await t.withIdentity({ subject: "user_1" }).action(api.media.uploadAuth, args);
    expect(auth.params.folder).toBe("/listings/slash");
    expect(auth.params.checks).toContain('"file.size" <= "5mb"');
    expect(auth.uploadUrl).toBe("https://upload.imagekit.io/api/v2/files/upload");
  });
});
