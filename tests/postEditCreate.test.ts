// Create's edit mode (lib/studio/postEdit.ts): the edit link, a design
// recipe as Create's choices, the best-effort start for an image without
// one, what Update post renders and the media list it sends.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import type { DesignView, MediaDetail } from "../convex/lib/design";
import { filledFields, renderArgs, shotFor, shownCarouselFields, shownFields, type Design, type Fields } from "../lib/studio/create";
import {
  NO_RECIPE_NOTE,
  NO_SHOT,
  VIDEO_NOTE,
  appendItems,
  carouselCanRender,
  describeUpdate,
  editBlockReason,
  editDraftId,
  editFormat,
  editOutputAllowed,
  editRenderArgs,
  editResetText,
  factsAsFields,
  headlineFromCaptions,
  parseEditTarget,
  postTitle,
  type EditSeed,
  queueUrlFor,
  replaceItem,
  seedForEdit,
  seedFromPost,
  seedFromRecipe,
  targetLabel,
  targetProblem,
  type EditablePost,
  type MediaItem,
} from "../lib/studio/postEdit";

const POST_ID = "k57abcdefghij0123456789xyz";
const LISTING = "j97listing000000000000000" as Id<"listings">;
const IMG = (n: number) => `https://ik.imagekit.io/x/social/graphics/g${n}.jpg`;
const SHOT = "https://ik.imagekit.io/x/listings/floema/cover.jpg";

const graphic: DesignView = {
  kind: "graphic",
  template: "new_listing",
  format: "square",
  style: "magazine",
  palette: "house",
  glass: "liquid",
  fields: { title: "Floema", studio: "Studio X", tagline: "A calm site.", kicker: "Fresh today" },
  imageUrls: [SHOT],
};

type CarouselView = Extract<DesignView, { kind: "carousel" }>;

const STORY = { chips: ["Type", "Motion"], notes: ["n1"], cta: "See it", glass: "tint", shots: [SHOT], mobile: "https://ik.imagekit.io/x/m.jpg" };

function slide(i: number, total = 3, setId = "set-a"): DesignView {
  return {
    kind: "carousel",
    listingId: LISTING,
    listingSlug: "floema",
    palette: "auto",
    style: "glass",
    facts: { quote: "Lovely type.", juror: "Ana", title: "Floema (override)" },
    story: STORY,
    slideIndex: i,
    slideName: i === 0 ? "hook" : "site",
    total,
    setId,
  };
}

const detail = (url: string, design: DesignView | null, kind: "image" | "video" = "image"): MediaDetail => ({
  url,
  mediaId: null,
  kind,
  width: 1080,
  height: 1350,
  durationSec: null,
  design,
});

function post(over: Partial<EditablePost> = {}): EditablePost {
  return {
    kind: "new_listing",
    placement: "feed",
    listing: { slug: "floema", title: "Floema" },
    facts: {
      title: "Floema",
      tagline: "A calm site.",
      siteUrl: "https://www.floema.com/work",
      studio: { name: "Studio X" },
      award: { tier: "SOTD", date: "2026-11-12", pageUrl: "https://shemoqmedi.space/awards/floema-sotd-2026-11-12" },
    },
    captions: { instagram: "New on Shemoqmedi: Floema by Studio X.\n\n#webdesign" },
    media: [{ kind: "image", url: IMG(1), role: "graphic" }],
    mediaDetails: [detail(IMG(1), graphic)],
    ...over,
  };
}

function design(over: Partial<Design> = {}): Design {
  return {
    source: "listing",
    output: "single",
    template: "new_listing",
    format: "square",
    style: "magazine",
    palette: "house",
    glass: "frost",
    fields: { title: "Floema", studio: "Studio X", tagline: "A calm site.", url: "" },
    carouselFields: { quote: "", juror: "", role: "", cta: "" },
    shot: SHOT,
    listingId: null,
    ...over,
  };
}

describe("the edit link", () => {
  it("reads ?post=&item= and ?post=&mode=add, and ignores anything else", () => {
    expect(parseEditTarget({ post: POST_ID, item: "2" })).toEqual({ postId: POST_ID, item: 2 });
    expect(parseEditTarget({ post: [POST_ID], item: ["0"] })).toEqual({ postId: POST_ID, item: 0 });
    expect(parseEditTarget({ post: POST_ID, mode: "add" })).toEqual({ postId: POST_ID, item: null });
    expect(parseEditTarget({ post: POST_ID })).toBeNull();
    expect(parseEditTarget({ post: POST_ID, item: "-1" })).toBeNull();
    expect(parseEditTarget({ post: POST_ID, item: "x" })).toBeNull();
    expect(parseEditTarget({ post: "../etc", item: "0" })).toBeNull();
    expect(parseEditTarget({})).toBeNull();
  });

  it("keeps its draft apart from the normal Create draft and returns to the post", () => {
    expect(editDraftId({ postId: POST_ID, item: 3 })).toBe(`${POST_ID}:3`);
    expect(editDraftId({ postId: POST_ID, item: null })).toBe(`${POST_ID}:add`);
    expect(queueUrlFor(POST_ID)).toBe(`/queue?post=${POST_ID}`);
    const create = readFileSync("components/studio/create/Create.tsx", "utf8");
    expect(create).toMatch(/createDraftStore<CreateDraft>\("create-edit"\)/);
    expect(create).toMatch(/createDraftStore<CreateDraft>\("create"\)/);
    // Update post saves the media only: it never publishes or approves.
    const save = create.slice(create.indexOf("async function saveEdit"), create.indexOf("function onUpdate"));
    expect(save).toMatch(/updatePost\(\{ id: edit\.post\.id, media: nextMedia, baseMedia: base \?\? undefined \}\)/);
    expect(save).not.toMatch(/publishPost|approve/);
    // Update post and Cancel replace the edit page in history: Back from the post sheet does not reopen it.
    expect(save).toMatch(/router\.replace\(queueUrlFor\(edit\.post\.id\)\)/);
    const cancel = create.slice(create.indexOf("function cancelEdit"), create.indexOf("const outputHint"));
    expect(cancel).toMatch(/router\.replace\(queueUrlFor\(edit\.post\.id\)\)/);
    expect(create).not.toMatch(/router\.push\(queueUrlFor/);
  });

  it("says a scheduled post loses its time, in Create and the post sheet alike", () => {
    expect(editResetText("scheduled")).toMatch(/back to Waiting and its schedule is cancelled/);
    expect(editResetText("approved")).toBe("This post goes back to Waiting. You approve it again after.");
    expect(readFileSync("components/studio/create/Create.tsx", "utf8")).toMatch(/body=\{editResetText\(edit\.post\.status\)\}/);
    expect(readFileSync("components/studio/queue/MediaEditor.tsx", "utf8")).toMatch(/editResetText as resetText/);
  });

  it("starts over from the post as it is now, seed and base together", () => {
    const create = readFileSync("components/studio/create/Create.tsx", "utf8");
    const startOver = create.slice(create.indexOf("function startOver"), create.indexOf("const detail = useQuery"));
    expect(startOver).toMatch(/edit\.restart\(\)/);
    const loader = readFileSync("components/studio/create/EditCreate.tsx", "utf8");
    expect(loader).toMatch(/restart = \(\) => setStart\(\(s\) => \(\{ n: s\.n \+ 1, seed: seedForEdit\(post, target, listingId\) \}\)\)/);
    expect(loader).toMatch(/<Create key=\{start\.n\}/);
  });
});

describe("a recipe as Create's choices", () => {
  it("loads a single graphic: source from template, format, style, palette, glass, texts and screenshot", () => {
    const seed = seedFromRecipe(graphic, post(), LISTING);
    expect(seed).toMatchObject({
      source: "listing",
      output: "single",
      template: "new_listing",
      format: "square",
      style: "magazine",
      palette: "house",
      glass: "liquid",
      listingId: LISTING,
      shot: SHOT,
      note: null,
    });
    // Every box is seeded: the recipe's text, or empty (so the listing's facts don't fill what the recipe left to the defaults).
    expect(seed.edits.new_listing).toEqual({ title: "Floema", studio: "Studio X", tagline: "A calm site.", url: "" });
    expect(filledFields(seed.edits.new_listing!)).toEqual({ title: "Floema", studio: "Studio X", tagline: "A calm site." });
    // Texts the editor has no box for are carried to the render.
    expect(seed.carry).toEqual({ kind: "graphic", template: "new_listing", fields: { kicker: "Fresh today" }, extraImages: [] });
  });

  it("maps templates to sources, and a site template without a site to free text", () => {
    expect(seedFromRecipe({ ...graphic, template: "award", imageUrls: [SHOT, "https://x/badge.png"] }, post(), LISTING)).toMatchObject({
      source: "award",
      listingId: LISTING,
      carry: { extraImages: ["https://x/badge.png"] },
    });
    expect(seedFromRecipe({ ...graphic, template: "call_jury", imageUrls: [] }, post(), LISTING)).toMatchObject({ source: "call_jury", listingId: null, shot: NO_SHOT });
    expect(seedFromRecipe(graphic, post({ listing: null }), null)).toMatchObject({ source: "free", listingId: null });
    expect(seedFromRecipe({ ...graphic, template: "jury_quote" }, post(), LISTING).source).toBe("free");
  });

  it("makes a story post's edit a story, and falls back on unknown values", () => {
    const seed = seedFromRecipe({ ...graphic, format: "story", style: "neon", palette: "nope", glass: "x" }, post({ placement: "story" }), LISTING);
    expect(seed).toMatchObject({ output: "story", format: "story", style: "glass", palette: "auto", glass: "frost" });
    // A feed post's 9:16 recipe keeps its format (carried: Create's feed buttons have none for it).
    expect(seedFromRecipe({ ...graphic, format: "story" }, post(), LISTING)).toMatchObject({ output: "single", format: "story", carry: { format: "story" } });
    expect(seedFromRecipe({ ...graphic, template: "mystery" }, post({ kind: "announcement" }), null).template).toBe("announcement");
  });

  it("loads a carousel slide: listing, palette, style, glass, the four texts, the first shot; carries facts and story", () => {
    const seed = seedFromRecipe(slide(1), post(), null);
    expect(seed).toMatchObject({
      source: "listing",
      output: "carousel",
      palette: "auto",
      style: "glass",
      glass: "tint",
      listingId: LISTING,
      shot: SHOT,
      carouselEdits: { quote: "Lovely type.", juror: "Ana" },
    });
    expect(seed.carouselEdits).toEqual({ quote: "Lovely type.", juror: "Ana", role: "", cta: "" });
    expect(seed.carry).toEqual({ kind: "carousel", listingId: LISTING, facts: { title: "Floema (override)" }, story: STORY });
    expect(seedFromRecipe(slide(0), post({ kind: "award" }), null).source).toBe("award");
  });

  it("keeps a facts-only carousel facts-only: the post's listing is not used", () => {
    const factsOnly: DesignView = { ...(slide(0) as CarouselView), listingId: undefined, listingSlug: null, facts: { title: "Our jury is open" } };
    const seed = seedFromRecipe(factsOnly, post(), LISTING);
    expect(seed.listingId).toBeNull();
    expect(seed.carry).toMatchObject({ kind: "carousel", listingId: null });
    expect(carouselCanRender({ output: "carousel", listingId: null }, seed.carry)).toBe(true);
  });
});

describe("best effort without a recipe", () => {
  it("starts from the post's kind, site, texts and the item's screenshot, with a note", () => {
    const p = post({
      media: [
        { kind: "image", url: SHOT, role: "screenshot" },
        { kind: "video", url: "https://r2/x.mp4", role: "preview" },
      ],
      mediaDetails: [detail(SHOT, null), detail("https://r2/x.mp4", null, "video")],
    });
    const seed = seedFromPost(p, 0, LISTING);
    expect(seed).toMatchObject({ source: "listing", output: "single", template: "new_listing", listingId: LISTING, shot: SHOT, note: NO_RECIPE_NOTE, carry: null });
    expect(seed.edits.new_listing).toEqual({ title: "Floema", studio: "Studio X", tagline: "A calm site.", url: "floema.com" });
    expect(seedFromPost(p, 1, LISTING)).toMatchObject({ shot: null, note: VIDEO_NOTE });
    // seedForEdit picks the recipe when there is one.
    expect(seedForEdit(post(), { postId: POST_ID, item: 0 }, LISTING).note).toBeNull();
    expect(seedForEdit(p, { postId: POST_ID, item: 0 }, LISTING).note).toBe(NO_RECIPE_NOTE);
    // Adding a graphic starts from the post too, without a note.
    expect(seedForEdit(p, { postId: POST_ID, item: null }, LISTING)).toMatchObject({ note: null, shot: null });
  });

  it("fills award texts, story output and text templates from captions", () => {
    const award = seedFromPost(post({ kind: "award", placement: "story" }), 0, LISTING);
    expect(award).toMatchObject({ source: "award", output: "story", format: "story", template: "award" });
    expect(award.edits.award).toMatchObject({ tier: "SOTD", date: "12 Nov 2026", awardSlug: "floema-sotd-2026-11-12", title: "Floema", studio: "Studio X" });
    const news = seedFromPost(post({ kind: "announcement", listing: null, facts: null, captions: { facebook: "We opened the jury.\nMore soon. https://x.y" } }), 0, null);
    expect(news).toMatchObject({ source: "announcement", template: "announcement", listingId: null });
    expect(news.edits.announcement).toEqual({ headline: "We opened the jury." });
  });

  it("restores a Studio-made post's own design from its facts", () => {
    const seed = seedFromPost(
      post({
        kind: "custom",
        facts: { madeIn: "studio", design: { template: "jury_quote", format: "link", style: "bento", palette: "house", output: "single" }, text: { quote: "Wow", juror: "Ana", site: "Floema" } },
      }),
      0,
      LISTING,
    );
    expect(seed).toMatchObject({ template: "jury_quote", format: "link", style: "bento", palette: "house", source: "free" });
    expect(seed.edits.jury_quote).toEqual({ quote: "Wow", juror: "Ana", site: "Floema" });
  });

  it("reads facts and captions plainly", () => {
    expect(headlineFromCaptions({ instagram: "#tag\n\nBig news today https://a.b #web" })).toBe("Big news today");
    expect(headlineFromCaptions({})).toBeUndefined();
    expect(headlineFromCaptions({ threads: "word ".repeat(40) })!.length).toBeLessThanOrEqual(121);
    // Instagram first (the cards' titles); emoji dropped, the graphics' fonts can't draw them.
    expect(headlineFromCaptions({ facebook: "Hello there 👋", instagram: "Hello, we're Shemoqmedi." })).toBe("Hello, we're Shemoqmedi.");
    expect(headlineFromCaptions({ facebook: "We're live 👋🏽 ✨" })).toBe("We're live");
    expect(factsAsFields({ facts: { studio: "Plain studio" }, captions: {}, listing: null })).toEqual({ studio: "Plain studio" });
    expect(postTitle(post())).toBe("Floema");
    expect(postTitle({ kind: "call_jury", listing: null, facts: null })).toBe("Call for jurors");
    expect(postTitle({ kind: "custom", listing: null, facts: { text: { headline: "Hello" } } })).toBe("Hello");
  });
});

describe("rules for an edit", () => {
  it("keeps a story a story and a feed post in the feed", () => {
    expect(editOutputAllowed("story", "story")).toBe(true);
    expect(editOutputAllowed("single", "story")).toBe(false);
    expect(editOutputAllowed("carousel", "story")).toBe(false);
    expect(editOutputAllowed("single", "feed")).toBe(true);
    expect(editOutputAllowed("carousel", "feed")).toBe(true);
    expect(editOutputAllowed("story", "feed")).toBe(false);
  });

  it("says why a post or item can't be edited", () => {
    expect(editBlockReason({ status: "waiting" }, { publishing: false, edit: true })).toBeNull();
    expect(editBlockReason({ status: "scheduled" }, { publishing: true, edit: false })).toMatch(/being published/);
    expect(editBlockReason({ status: "sent" }, { publishing: false, edit: false })).toMatch(/is sent/);
    expect(editBlockReason({ status: "rejected" }, { publishing: false, edit: false })).toMatch(/rejected/);
    expect(targetProblem(post(), { postId: POST_ID, item: 0 })).toBeNull();
    expect(targetProblem(post(), { postId: POST_ID, item: 4 })).toMatch(/no longer/);
    expect(targetProblem(post({ placement: "story" }), { postId: POST_ID, item: null })).toMatch(/A story is one image/);
    expect(targetProblem(post({ placement: "story", media: [] }), { postId: POST_ID, item: null })).toBeNull();
    const ten = Array.from({ length: 10 }, (_, i) => ({ kind: "image" as const, url: IMG(i) }));
    expect(targetProblem(post({ media: ten }), { postId: POST_ID, item: null })).toMatch(/10/);
  });
});

describe("what Update post renders", () => {
  it("passes a graphic's carried texts and image slots while its template is kept", () => {
    const carry = { kind: "graphic" as const, template: "award" as const, fields: { kicker: "Fresh" }, extraImages: ["https://x/badge.png"] };
    const d = design({ template: "award", fields: { title: "Floema", tier: "SOTD" } });
    const args = editRenderArgs(d, carry);
    expect(args.fields).toEqual({ kicker: "Fresh", title: "Floema", tier: "SOTD" });
    expect(args.imageUrls).toEqual([SHOT, "https://x/badge.png"]);
    expect(args.story).toBeUndefined();
    // Another template: Create's own arguments only.
    expect(editRenderArgs(design(), carry)).toEqual({ ...renderArgs(design()), story: undefined });
    expect(editRenderArgs(design(), null)).toEqual({ ...renderArgs(design()), story: undefined });
  });

  it("passes a carousel's facts and story back, while it is the same site", () => {
    const seed = seedFromRecipe(slide(0), post(), null);
    const d = design({ output: "carousel", listingId: LISTING, style: "glass", glass: "tint", palette: "auto", carouselFields: { quote: "Lovely type.", juror: "Ana", role: "", cta: "" } });
    const args = editRenderArgs(d, seed.carry);
    expect(args).toMatchObject({
      template: "new_listing",
      format: "ig_portrait",
      carousel: true,
      listingId: LISTING,
      glass: "tint",
      fields: { title: "Floema (override)", quote: "Lovely type.", juror: "Ana" },
      imageUrls: [SHOT],
      story: { chips: ["Type", "Motion"], notes: ["n1"], cta: "See it", mobile: "https://ik.imagekit.io/x/m.jpg" },
    });
    // Another site: nothing of the old one goes along.
    const other = editRenderArgs({ ...d, listingId: "j97other" }, seed.carry);
    expect(other.story).toBeUndefined();
    expect(other.imageUrls).toBeUndefined();
    expect(other.fields).toEqual({ quote: "Lovely type.", juror: "Ana" });
  });

  it("lets a facts-only carousel render without a listing when it has a title", () => {
    const factsOnly = { kind: "carousel" as const, listingId: null, facts: { title: "Floema" }, story: {} };
    expect(carouselCanRender({ output: "carousel", listingId: null }, factsOnly)).toBe(true);
    expect(carouselCanRender({ output: "carousel", listingId: null }, { ...factsOnly, facts: {} })).toBe(false);
    expect(carouselCanRender({ output: "carousel", listingId: null }, null)).toBe(false);
    expect(carouselCanRender({ output: "carousel", listingId: LISTING }, null)).toBe(true);
    expect(carouselCanRender({ output: "single", listingId: null }, null)).toBe(true);
  });
});

/** The design Create builds from a seed while a listing is loaded (its facts and screenshots on offer), as Create.tsx does. */
function asCreate(seed: EditSeed, listing: { base: Fields; shots: string[]; juryNote: string | null }): Design {
  const template = seed.output === "carousel" ? (seed.source === "award" ? "award" : "new_listing") : seed.template;
  return {
    source: seed.source,
    output: seed.output,
    template,
    format: editFormat(seed.output, seed.format, seed.carry),
    style: seed.style,
    palette: seed.palette,
    glass: seed.glass,
    fields: shownFields(template, seed.edits[template], listing.base),
    carouselFields: shownCarouselFields(seed.carouselEdits, listing.juryNote),
    shot: shotFor(seed.shot, listing.shots),
    listingId: seed.listingId,
  };
}

describe("an unchanged recipe renders the same graphic again", () => {
  const loaded = {
    base: { title: "Floema", studio: "Studio X", tagline: "Listing tagline", url: "floema.com", site: "Floema", quote: "Listing jury note", score: "8.4" },
    shots: ["https://ik.imagekit.io/x/listings/floema/cover.jpg", "https://ik.imagekit.io/x/listings/floema/2.jpg"],
    juryNote: "Listing jury note",
  };

  it("a graphic without an image or some texts: no listing cover, no listing texts", () => {
    const recipe: DesignView = { kind: "graphic", template: "new_listing", format: "square", style: "glass", palette: "house", glass: "liquid", fields: { title: "Floema", studio: "Studio X" }, imageUrls: [] };
    const seed = seedFromRecipe(recipe, post(), LISTING);
    const args = editRenderArgs(asCreate(seed, loaded), seed.carry);
    expect(args).toMatchObject({ template: "new_listing", format: "square", style: "glass", palette: "house", glass: "liquid" });
    expect(args.fields).toEqual(recipe.fields);
    expect(args.imageUrls).toBeUndefined();
  });

  it("a graphic with its own image, extra texts and a reel cover format", () => {
    const recipe: DesignView = { ...graphic, format: "reel_cover", style: "swiss", imageUrls: [loaded.shots[1]] };
    const seed = seedFromRecipe(recipe, post(), LISTING);
    const d = asCreate(seed, loaded);
    expect(d.format).toBe("reel_cover");
    const args = editRenderArgs(d, seed.carry);
    expect(args).toMatchObject({ template: "new_listing", format: "reel_cover", style: "swiss", palette: "house" });
    expect(args.fields).toEqual(recipe.fields);
    expect(args.imageUrls).toEqual([loaded.shots[1]]);
    // Once a feed format is chosen, that one is rendered.
    expect(editRenderArgs({ ...d, format: editFormat("single", "square", seed.carry) }, seed.carry).format).toBe("square");
  });

  it("a carousel without a quote: not the listing's jury note", () => {
    const recipe: CarouselView = { ...(slide(0) as CarouselView), facts: { juror: "Ana", title: "Floema (override)" } };
    const seed = seedFromRecipe(recipe, post(), null);
    const args = editRenderArgs(asCreate(seed, loaded), seed.carry);
    expect(args).toMatchObject({ carousel: true, listingId: LISTING, style: "glass", palette: "auto", imageUrls: STORY.shots });
    expect(args.fields).toEqual(recipe.facts);
  });
});

describe("the media list Update post sends", () => {
  const media: MediaItem[] = [
    { kind: "image", url: IMG(0), role: "carousel", networks: ["threads"] },
    { kind: "image", url: IMG(1), role: "carousel", networks: ["instagram", "facebook"] },
    { kind: "image", url: IMG(2), role: "carousel", networks: ["instagram", "facebook"] },
    { kind: "image", url: IMG(3), role: "graphic" },
    { kind: "image", url: IMG(4), role: "carousel", networks: ["instagram", "facebook"] },
  ];
  const details = [detail(IMG(0), slide(0)), detail(IMG(1), slide(0)), detail(IMG(2), slide(1)), detail(IMG(3), graphic), detail(IMG(4), slide(2))];
  const fresh = ["n0", "n1", "n2", "n3"].map((n) => `https://ik.imagekit.io/x/social/carousel/b/${n}.jpg`);

  it("replaces one image in place, keeping its networks", () => {
    const out = replaceItem(media, details, 3, [IMG(9)], "graphic");
    expect(out.map((m) => m.url)).toEqual([IMG(0), IMG(1), IMG(2), IMG(9), IMG(4)]);
    expect(out[3]).toEqual({ kind: "image", url: IMG(9), role: "graphic" });
    const video: MediaItem[] = [{ kind: "video", url: "https://r2/v.mp4", role: "preview", networks: ["instagram"] }];
    expect(replaceItem(video, [detail("https://r2/v.mp4", null, "video")], 0, [IMG(9)], "graphic")).toEqual([{ kind: "image", url: IMG(9), role: "graphic", networks: ["instagram"] }]);
  });

  it("replaces a carousel's whole set: new slides in the set's first place, the Threads hook copy updated in its own", () => {
    const out = replaceItem(media, details, 2, fresh, "carousel");
    expect(out).toEqual([
      { kind: "image", url: fresh[0], role: "carousel", networks: ["threads"] },
      ...fresh.map((url) => ({ kind: "image", url, role: "carousel", networks: ["instagram", "facebook"] })),
      { kind: "image", url: IMG(3), role: "graphic" },
    ]);
    expect(describeUpdate(media, details, { postId: POST_ID, item: 2 }, 4)).toBe("Replaces the carousel (4 slides) with these 4 images.");
    expect(targetLabel({ media, mediaDetails: details }, { postId: POST_ID, item: 2 })).toBe("the carousel");
  });

  it("appends in add mode, and words each change plainly", () => {
    expect(appendItems(media.slice(3, 4), [IMG(8)], "graphic")).toEqual([media[3], { kind: "image", url: IMG(8), role: "graphic" }]);
    expect(describeUpdate(media, details, { postId: POST_ID, item: null }, 1)).toBe("Adds this image to the post.");
    expect(describeUpdate(media, details, { postId: POST_ID, item: 3 }, 1)).toBe("Replaces image 4 of 5.");
    expect(targetLabel({ media, mediaDetails: details }, { postId: POST_ID, item: 3 })).toBe("image 4");
    expect(targetLabel({ media: media.slice(3, 4), mediaDetails: details.slice(3, 4) }, { postId: POST_ID, item: 0 })).toBe("the image");
    expect(targetLabel({ media, mediaDetails: details }, { postId: POST_ID, item: null })).toBe("a new image");
    expect(() => replaceItem(media, details, 9, [IMG(9)], "graphic")).toThrow(/no longer/);
  });
});
