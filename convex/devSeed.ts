import { internalMutation } from "./_generated/server";

// ─────────────────────────────────────────────────────────────────────────────
// DEV SEED — Signature (RULED) menu template demo venue
//
// Run:  npx convex run devSeed:seedSignatureDemo
//
// Creates/refreshes a self-contained demo tenant (clerkId "org_demo_signature",
// slug "signature-demo") with a full trilingual menu, featured items, gallery,
// ticker and story — everything the Signature template renders. Idempotent:
// wipes and re-inserts only rows belonging to this demo org. The demo venue
// row stays isPublished:false so it never enters the public directory or
// sitemap; /menu/signature-demo still resolves via publicMenu.get.
// ─────────────────────────────────────────────────────────────────────────────

const ORG_ID = "org_demo_signature";
const SLUG = "signature-demo";

const U = (id: string) =>
  `https://images.unsplash.com/${id}?q=80&w=1600&auto=format&fit=crop`;

const IMG = {
  cover: U("photo-1521017432531-fbd92d768814"),
  story: U("photo-1442512595331-e89e73853f31"),
  gallery: [
    U("photo-1554118811-1e0d58224f24"),
    U("photo-1509042239860-f550ce710b93"),
    U("photo-1442512595331-e89e73853f31"),
    U("photo-1447933601403-0c6688de566e"),
    U("photo-1504630083234-14187a9df0f5"),
    U("photo-1525610553991-2bede1a236e2"),
  ],
  flatWhite: U("photo-1541167760496-1628856ab772"),
  espressoTonic: U("photo-1510017803434-a899398421b3"),
  cappuccino: U("photo-1572442388796-11668a67e53d"),
  v60: U("photo-1495474472287-4d71bcdd2085"),
  coldBrew: U("photo-1517701550927-30cf4ba1dba5"),
  croissant: U("photo-1555507036-ab1f4038808a"),
  cheesecake: U("photo-1524351199678-941a58a3df50"),
  bun: U("photo-1509440159596-0249088772ff"),
  avocado: U("photo-1541519227354-08fa5d50c44d"),
  brunch: U("photo-1533089860892-a7c6f0a88666"),
};

type Tx = { en: string; ka?: string; ru?: string };

const CATEGORIES: Array<{
  name: Tx;
  imageUrl?: string;
  items: Array<{
    name: Tx;
    description?: Tx;
    price: number; // tetri
    imageUrl?: string;
    tags?: string[];
    isFeatured?: boolean;
  }>;
}> = [
  {
    name: { en: "Espresso Bar", ka: "ესპრესო ბარი", ru: "Эспрессо-бар" },
    imageUrl: IMG.flatWhite,
    items: [
      {
        name: { en: "Flat White", ka: "ფლეთ ვაითი", ru: "Флэт уайт" },
        description: {
          en: "Double ristretto, velvet milk, no foam theatrics.",
          ka: "ორმაგი რისტრეტო, ხავერდოვანი რძე, ზედმეტი ქაფის გარეშე.",
          ru: "Двойной ристретто, бархатное молоко, без пенных спецэффектов.",
        },
        price: 950,
        imageUrl: IMG.flatWhite,
        tags: ["signature"],
        isFeatured: true,
      },
      {
        name: { en: "Espresso Tonic", ka: "ესპრესო ტონიკი", ru: "Эспрессо-тоник" },
        description: {
          en: "Single origin over artisan tonic, orange oil, lots of ice.",
          ka: "სინგლ ორიჯინი ტონიკზე, ფორთოხლის ცედრა, ბევრი ყინული.",
          ru: "Сингл ориджин на тонике, апельсиновое масло, много льда.",
        },
        price: 1100,
        imageUrl: IMG.espressoTonic,
        tags: ["cold", "sparkling"],
        isFeatured: true,
      },
      {
        name: { en: "Cortado", ka: "კორტადო", ru: "Кортадо" },
        description: {
          en: "Equal parts espresso and steamed milk. Small and serious.",
          ka: "ესპრესო და რძე თანაბრად. პატარა და სერიოზული.",
          ru: "Эспрессо и молоко поровну. Маленький и серьёзный.",
        },
        price: 850,
      },
      {
        name: { en: "Cappuccino", ka: "კაპუჩინო", ru: "Капучино" },
        description: {
          en: "Classic ratio, cocoa on request only.",
          ka: "კლასიკური პროპორცია, კაკაო — მხოლოდ თხოვნით.",
          ru: "Классическая пропорция, какао только по просьбе.",
        },
        price: 900,
        imageUrl: IMG.cappuccino,
      },
    ],
  },
  {
    name: { en: "Filter & Brew", ka: "ფილტრი და ბრიუ", ru: "Фильтр и брю" },
    imageUrl: IMG.v60,
    items: [
      {
        name: { en: "V60 — Ethiopia Guji", ka: "V60 — ეთიოპია გუჯი", ru: "V60 — Эфиопия Гуджи" },
        description: {
          en: "Floral, bergamot, apricot. 15g dose, 3:30 pour.",
          ka: "ყვავილოვანი, ბერგამოტი, გარგარი. 15გ დოზა, 3:30 ჩასხმა.",
          ru: "Цветочный, бергамот, абрикос. Доза 15 г, пролив 3:30.",
        },
        price: 1300,
        imageUrl: IMG.v60,
        tags: ["single origin"],
        isFeatured: true,
      },
      {
        name: { en: "Chemex for Two", ka: "ქემექსი ორისთვის", ru: "Кемекс на двоих" },
        description: {
          en: "600ml of whatever the roaster is proudest of this week.",
          ka: "600მლ ის, რითაც მწველი ამ კვირაში ყველაზე ამაყობს.",
          ru: "600 мл того, чем обжарщик гордится на этой неделе.",
        },
        price: 1900,
        tags: ["to share"],
      },
      {
        name: { en: "Cold Brew", ka: "ქოლდ ბრიუ", ru: "Колд брю" },
        description: {
          en: "18-hour steep, dark chocolate finish.",
          ka: "18-საათიანი დაყენება, შავი შოკოლადის ფინიში.",
          ru: "18 часов настаивания, финиш тёмного шоколада.",
        },
        price: 1000,
        imageUrl: IMG.coldBrew,
        tags: ["cold"],
      },
      {
        name: { en: "Batch Brew", ka: "ბეჩ ბრიუ", ru: "Батч брю" },
        price: 700,
      },
    ],
  },
  {
    name: { en: "Pastry", ka: "ნამცხვრები", ru: "Выпечка" },
    imageUrl: IMG.croissant,
    items: [
      {
        name: { en: "Butter Croissant", ka: "კარაქიანი კრუასანი", ru: "Круассан на масле" },
        description: {
          en: "Laminated over three days. Gone by noon.",
          ka: "სამი დღის ლამინირება. შუადღემდე იყიდება ხოლმე.",
          ru: "Три дня ламинации. К полудню обычно заканчивается.",
        },
        price: 650,
        imageUrl: IMG.croissant,
      },
      {
        name: { en: "Cardamom Bun", ka: "კარდამონის ფუნთუშა", ru: "Булочка с кардамоном" },
        price: 750,
        imageUrl: IMG.bun,
      },
      {
        name: { en: "Basque Cheesecake", ka: "ბასკური ჩიზქეიქი", ru: "Баскский чизкейк" },
        description: {
          en: "Burnt top, molten centre.",
          ka: "შემწვარი ზედაპირი, დნობადი გული.",
          ru: "Подгоревший верх, тающая середина.",
        },
        price: 1250,
        imageUrl: IMG.cheesecake,
        tags: ["signature"],
        isFeatured: true,
      },
    ],
  },
  {
    name: { en: "Brunch", ka: "ბრანჩი", ru: "Бранч" },
    imageUrl: IMG.brunch,
    items: [
      {
        name: { en: "Adjarian Khachapuri", ka: "აჭარული ხაჭაპური", ru: "Аджарский хачапури" },
        description: {
          en: "The boat. Guda cheese, farm egg, too much butter.",
          ka: "ნავი. გუდის ყველი, სოფლის კვერცხი, ბევრი კარაქი.",
          ru: "Лодочка. Сыр гуда, фермерское яйцо, слишком много масла.",
        },
        price: 1850,
        imageUrl: IMG.brunch,
        tags: ["georgian"],
      },
      {
        name: { en: "Avocado Toast", ka: "ავოკადოს ტოსტი", ru: "Тост с авокадо" },
        description: {
          en: "Sourdough, chili crunch, cured yolk.",
          ka: "მაჟავე პური, ჩილის კრანჩი, დამარილებული გული.",
          ru: "Закваска, чили-кранч, вяленый желток.",
        },
        price: 1450,
        imageUrl: IMG.avocado,
        tags: ["vegan option"],
      },
      {
        name: { en: "Shakshuka", ka: "შაქშუკა", ru: "Шакшука" },
        price: 1550,
        tags: ["spicy"],
      },
      {
        name: { en: "Granola Bowl", ka: "გრანოლას თასი", ru: "Гранола-боул" },
        price: 1150,
        tags: ["vegan", "gf"],
      },
    ],
  },
];

export const seedSignatureDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // ── Wipe previous demo rows (this tenant only) ────────────────────────
    const oldItems = await ctx.db
      .query("menuItems")
      .withIndex("by_org", (q) => q.eq("orgId", ORG_ID))
      .collect();
    for (const i of oldItems) await ctx.db.delete(i._id);

    const oldCats = await ctx.db
      .query("categories")
      .withIndex("by_org", (q) => q.eq("orgId", ORG_ID))
      .collect();
    for (const c of oldCats) await ctx.db.delete(c._id);

    // ── Organization ──────────────────────────────────────────────────────
    const orgDoc = {
      clerkId: ORG_ID,
      name: "NOIR ROASTERY",
      slug: SLUG,
      currency: "GEL",
      timezone: "Asia/Tbilisi",
      storefrontConfig: {
        heroHeadline: { en: "NOIR ROASTERY" },
        heroSubheadline: {
          en: "Specialty coffee, records, and slow mornings in Sololaki.",
          ka: "სპეშალითი ყავა, ფირფიტები და ნელი დილები სოლოლაკში.",
          ru: "Спешелти кофе, пластинки и медленные утра в Сололаки.",
        },
        coverImageUrl: IMG.cover,
        heroImageUrls: [IMG.gallery[0], IMG.gallery[1], IMG.gallery[2]],
        address: {
          en: "3 Lermontov St, Sololaki",
          ka: "ლერმონტოვის 3, სოლოლაკი",
          ru: "ул. Лермонтова 3, Сололаки",
        },
        cityStateZip: { en: "Tbilisi, 0105", ka: "თბილისი, 0105", ru: "Тбилиси, 0105" },
        lat: 41.6903,
        lng: 44.8015,
      },
      operatingHours: [
        { day: "Mon – Fri", hours: "08:00 – 20:00" },
        { day: "Sat – Sun", hours: "09:00 – 21:00" },
      ],
      socialLinks: {
        whatsapp: "+995599123456",
        instagram: "noir.tbilisi",
        email: "hello@noir.ge",
      },
      themeSettings: {
        primaryColor: "#D8FF3A",
        backgroundColor: "#0A0A0A",
        textColor: "#F4F3F0",
        fontFamily: "Space Grotesk",
        buttonRadius: "0px",
        menuType: "ruled" as const,
        categoryLayout: "pills" as const,
      },
      ruledMenuConfig: {
        tickerText: {
          en: "Roasted in Tbilisi every Tuesday — Single origin only — Est. 2021",
          ka: "მოხალული თბილისში ყოველ სამშაბათს — მხოლოდ სინგლ ორიჯინი — 2021",
          ru: "Обжарка в Тбилиси каждый вторник — Только сингл ориджин — 2021",
        },
        storyText: {
          en: "We started in a basement on Vertskhli street with a 1978 Probat and one stubborn idea — Tbilisi deserves coffee roasted the same week you drink it. Everything on this menu is built around that week.",
          ka: "დავიწყეთ ვერცხლის ქუჩის სარდაფში 1978 წლის Probat-ით და ერთი ჯიუტი იდეით — თბილისი იმსახურებს ყავას, რომელიც იმავე კვირაშია მოხალული. მთელი ეს მენიუ ამ კვირის გარშემოა აწყობილი.",
          ru: "Мы начали в подвале на улице Верцхли со старым Probat 1978 года и одной упрямой идеей — Тбилиси заслуживает кофе, обжаренный на той же неделе. Всё это меню построено вокруг этой недели.",
        },
        storyImageUrl: IMG.story,
        galleryImageUrls: IMG.gallery,
        showTicker: true,
        showFeatured: true,
        showStory: true,
        showGallery: true,
      },
      announcements: [
        {
          id: "cupping-sunday",
          message: "Sunday cupping at 12:00 — free, six seats",
          isActive: true,
        },
      ],
      features: {
        hasNfcHardware: false,
        hasDigitalMenu: true,
        hasCustomDomain: false,
        hasAiManager: true,
        hasLiveOrdering: false,
      },
      isActive: true,
      updatedAt: now,
    };

    const existingOrg = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", ORG_ID))
      .unique();
    if (existingOrg) {
      await ctx.db.patch(existingOrg._id, orgDoc);
    } else {
      await ctx.db.insert("organizations", { ...orgDoc, createdAt: now });
    }

    // ── Venue (unpublished — never enters the public directory) ──────────
    const venueDoc = {
      orgId: ORG_ID,
      slug: SLUG,
      name: "NOIR ROASTERY",
      category: "cafe" as const,
      description:
        "Specialty coffee roastery and listening bar in Sololaki, Tbilisi.",
      address: "3 Lermontov St, Tbilisi",
      lat: 41.6903,
      lng: 44.8015,
      phone: "+995 599 12 34 56",
      coverImage: IMG.cover,
      galleryImages: IMG.gallery,
      tags: ["specialty coffee", "brunch", "vinyl"],
      googleRating: 4.9,
      googleReviewCount: 312,
      claimStatus: "claimed" as const,
      menuMode: "native" as const,
      isPublished: false,
      updatedAt: now,
    };

    const existingVenue = await ctx.db
      .query("venues")
      .withIndex("by_slug", (q) => q.eq("slug", SLUG))
      .unique();
    if (existingVenue) {
      await ctx.db.patch(existingVenue._id, venueDoc);
    } else {
      await ctx.db.insert("venues", { ...venueDoc, createdAt: now });
    }

    // ── Categories + items ────────────────────────────────────────────────
    let catSort = 0;
    let created = 0;
    for (const cat of CATEGORIES) {
      const categoryId = await ctx.db.insert("categories", {
        orgId: ORG_ID,
        name: cat.name as Record<string, string>,
        imageUrl: cat.imageUrl,
        sortOrder: catSort++,
        isActive: true,
      });
      let itemSort = 0;
      for (const item of cat.items) {
        await ctx.db.insert("menuItems", {
          orgId: ORG_ID,
          categoryId,
          name: item.name as Record<string, string>,
          description: item.description as Record<string, string> | undefined,
          price: item.price,
          imageUrl: item.imageUrl,
          tags: item.tags,
          isFeatured: item.isFeatured ?? false,
          isAvailable: true,
          sortOrder: itemSort++,
        });
        created++;
      }
    }

    return {
      org: ORG_ID,
      slug: SLUG,
      categories: CATEGORIES.length,
      items: created,
      url: `/en/menu/${SLUG}`,
    };
  },
});
