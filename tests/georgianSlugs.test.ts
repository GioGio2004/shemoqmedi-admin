import { describe, expect, it } from "vitest";
import { latinizeGeorgian } from "../convex/lib/georgian";
import { listingSlugBase, slugify } from "../convex/lib/listingHelpers";
import { safeSegment } from "../convex/lib/imagekitSign";

// Audit A-09: Georgian titles used to slug to "site", "site-2", ...

describe("Georgian in URLs", () => {
  it("transliterates Mkhedruli and Mtavruli with the national system", () => {
    expect(latinizeGeorgian("შემოქმედი")).toBe("shemokmedi");
    expect(latinizeGeorgian("ᲨᲔᲛᲝᲥᲛᲔᲓᲘ")).toBe("shemokmedi");
    expect(latinizeGeorgian("ჭაჭა, წყალი, ღვინო, ჟურნალი")).toBe("chacha, tsqali, ghvino, zhurnali");
    expect(latinizeGeorgian("Kencho ჯგუფი")).toBe("Kencho jgupi");
  });

  it("makes readable slugs and file names from Georgian titles", () => {
    expect(slugify("ქართული ვებსაიტი")).toBe("kartuli-vebsaiti");
    expect(safeSegment("თბილისის მენიუ", "site")).toBe("tbilisis-meniu");
  });

  it("falls back to the domain, not 'site', when a title has no usable letters", () => {
    expect(listingSlugBase("★★★", "https://www.kenchogroup.ge/")).toBe("kenchogroup-ge");
    expect(listingSlugBase("Slash", "https://slash.example")).toBe("slash");
    expect(listingSlugBase("★", "not a url")).toBe("site");
  });
});
