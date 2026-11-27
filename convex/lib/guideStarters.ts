// Starter team guides, added from the empty Guides page (guides.addStarters).
// Matched by slug: a guide that is already there is never overwritten, so
// editing one in the admin is safe. After they are added, the admin is the
// source of truth; this file is only the first version.
//
// Facts here must match the live pages:
//   https://www.shemoqmedi.space/jury/guide  (jury)
//   https://www.shemoqmedi.space/submit      (submissions)
// Text format (lib/guideText.ts): blank line = paragraph, "- " bullet,
// "1. " numbered step. {Curly brackets} are what the sender fills in.

export type StarterSection = {
  kind: "steps" | "template";
  heading: string;
  body: string;
  language?: "ka" | "en";
};

export type StarterGuide = {
  slug: string;
  title: string;
  summary: string;
  area: "networking" | "social" | "listings" | "jury" | "operations";
  roles: readonly ("everyone" | "owner" | "developer" | "ops")[];
  sections: readonly StarterSection[];
};

const JURY_GUIDE = "https://www.shemoqmedi.space/jury/guide";
const SUBMIT = "https://www.shemoqmedi.space/submit?utm_source=linkedin&utm_medium=dm&utm_campaign=listing-invite";

const juryInvitations: StarterGuide = {
  slug: "jury-invitations",
  title: "Jury invitations: first message and replies",
  summary: "What to send when inviting someone to the jury, and how to answer the replies we get most.",
  area: "networking",
  roles: ["owner", "ops", "developer"],
  sections: [
    {
      kind: "steps",
      heading: "Who sends what",
      body: `- Saba and Dima: send the connection requests and the first message to the cold leads on your own tab of the leads sheet ("dimas task" or "sabas task"). Everything goes from Giorgi's LinkedIn.
- Replies are Giorgi's. When someone answers, set their status in the sheet and tell Giorgi. Use the reply templates below only when he asks you to.
- Never message anyone on "giorgis task (my connections)". Those are Giorgi's own contacts.
- Send the connection request without a note. Send the first message after they accept.`,
    },
    {
      kind: "steps",
      heading: "Before you send",
      body: `1. Replace everything in {curly brackets}. Spell the name the way they spell it on their profile.
2. Say one real thing about their work: a site, product or portfolio you actually opened. If you can't find one, don't send.
3. Georgian speakers get the Georgian version, everyone else the English one. Cold messages use the formal "თქვენ".
4. Only say what is on the jury guide (${JURY_GUIDE}). Never promise money, an award, a number of followers, or anything else that isn't there.
5. Never name another juror's employer, and never use any company's logo.
6. One follow-up at most, 5 to 7 days after the first message. After that, set the status and stop.`,
    },
    {
      kind: "steps",
      heading: "Facts you can use",
      body: `All from the live jury guide. If a question isn't covered here, ask Giorgi before answering.

- Jurors score sites from 1 to 10 on four criteria: design 40%, usability 30%, creativity 20%, content 10%. A short comment is optional.
- A site needs at least 3 jury scores to be eligible for an award. Only the jury decides awards; community votes never count.
- Scores stay private while a site is in voting. When judging closes, the score and comment appear on the site's page and the juror's profile, with their name.
- About 10 to 15 minutes per site. We'd love around 5 to 15 sites a month, but how many is up to them.
- A daily email when there are new sites in the categories they follow, and a reminder a day before voting closes on a site they haven't scored.
- They don't score their own or their company's sites (one click in the Evaluate form declares the conflict).
- Voluntary and unpaid.
- We prepare their profile from their LinkedIn and send it, with the announcement post, for their approval before anything is published.
- Then they get a private link, sign in with the invited email, and the profile is theirs to edit.
- They get a public jury profile, "Jury Member, Shemoqmedi Awards" for LinkedIn (one click from their profile), an announcement on our Instagram, Facebook and LinkedIn (approved by them first), and founding jurors keep the Founding Jury mark.`,
    },
    {
      kind: "template",
      language: "en",
      heading: "First message (English)",
      body: `Hi {first name}, I'm Giorgi, founder of Shemoqmedi (shemoqmedi.space), an awards platform for web design. Every site is scored by a jury of designers, developers and founders, and the best become Site of the Day, Site of the Month and Site of the Year.

We're putting together the founding jury, and {their project or site} shows exactly the eye we're looking for. It's voluntary and flexible: about 10 to 15 minutes per site, as many sites a month as you have time for. You get a public jury profile and "Jury Member, Shemoqmedi Awards" for your LinkedIn.

Everything is explained here: ${JURY_GUIDE}

Would you like to join?`,
    },
    {
      kind: "template",
      language: "ka",
      heading: "First message (Georgian)",
      body: `გამარჯობა {სახელი}, მე გიორგი ვარ, Shemoqmedi-ს (shemoqmedi.space) დამფუძნებელი. ეს არის ვებდიზაინის დაჯილდოების პლატფორმა: ყველა საიტს აფასებს ჟიური, რომელშიც დიზაინერები, დეველოპერები და დამფუძნებლები არიან, საუკეთესოები კი იღებენ ჯილდოებს Site of the Day, Site of the Month და Site of the Year.

ახლა ვაყალიბებთ დამფუძნებელ ჟიურის და {მათი პროექტი ან საიტი} ზუსტად იმ ხედვას აჩვენებს, რასაც ვეძებთ. წევრობა მოხალისეობრივი და მოქნილია: ერთ საიტზე დაახლოებით 10–15 წუთი, თვეში იმდენი საიტი, რამდენზეც დრო გექნებათ. მიიღებთ საჯარო ჟიურის პროფილს და LinkedIn-ზე „Jury Member, Shemoqmedi Awards“-ს.

ყველაფერი აქ არის ახსნილი: ${JURY_GUIDE}

შემოგვიერთდებით?`,
    },
    {
      kind: "template",
      language: "en",
      heading: "Reply: asks for details (\"what does jury membership mean?\")",
      body: `Thanks for asking, {first name}! In short:

- You score websites submitted to Shemoqmedi from 1 to 10 on four criteria: design (40%), usability (30%), creativity (20%) and content (10%). A short comment is optional, but it's what creators value most.
- A site needs at least 3 jury scores to be eligible for an award. Only the jury decides awards.
- Scores stay private while a site is in voting. When judging closes, your score and comment appear on the site's page with your name.
- It takes about 10 to 15 minutes per site. We'd love around 5 to 15 sites a month, but how many is up to you.
- It's voluntary and unpaid. In return you get a public jury profile, "Jury Member, Shemoqmedi Awards" for your LinkedIn, an announcement on our pages (you approve it first) and, as a founding juror, the Founding Jury mark.
- We prepare your profile from your LinkedIn and send it to you for approval before anything is published. Then you get a private link to claim it.

The full guide, with a real example: ${JURY_GUIDE}

Happy to answer anything else.`,
    },
    {
      kind: "template",
      language: "ka",
      heading: "Reply: asks for details (Georgian)",
      body: `მადლობა კითხვისთვის, {სახელი}! მოკლედ:

- აფასებთ Shemoqmedi-ზე გამოგზავნილ საიტებს 1-დან 10-მდე ოთხი კრიტერიუმით: დიზაინი (40%), გამოყენებადობა (30%), კრეატიულობა (20%) და კონტენტი (10%). მოკლე კომენტარი არასავალდებულოა, თუმცა შემქმნელებისთვის ყველაზე ღირებული სწორედ ისაა.
- ჯილდოს მისაღებად საიტს ჟიურის მინიმუმ 3 შეფასება სჭირდება. ჯილდოებს მხოლოდ ჟიური წყვეტს.
- სანამ საიტის შეფასება მიმდინარეობს, ქულები არავის უჩანს. შეფასების დასრულების შემდეგ თქვენი ქულა და კომენტარი თქვენი სახელით გამოჩნდება საიტის გვერდზე.
- ერთ საიტს დაახლოებით 10–15 წუთი სჭირდება. კარგი იქნება თვეში 5–15 საიტი, მაგრამ რაოდენობას თქვენ წყვეტთ.
- წევრობა მოხალისეობრივია და ანაზღაურება არ აქვს. სამაგიეროდ მიიღებთ საჯარო ჟიურის პროფილს, LinkedIn-ზე „Jury Member, Shemoqmedi Awards“-ს, ანონსს ჩვენს გვერდებზე (ჯერ თქვენ დაამტკიცებთ) და, როგორც დამფუძნებელი ჟიურის წევრი, Founding Jury ნიშანს.
- პროფილს თქვენი LinkedIn-ის მიხედვით ვამზადებთ და გამოქვეყნებამდე დასამტკიცებლად გიგზავნით. შემდეგ მიიღებთ პირად ბმულს, რომლითაც პროფილს დაიკავებთ.

სრული გზამკვლევი, რეალური მაგალითით: ${JURY_GUIDE}

სხვა კითხვაც თუ გაქვთ, სიამოვნებით გიპასუხებთ.`,
    },
    {
      kind: "template",
      language: "en",
      heading: "Reply: says yes",
      body: `Wonderful, thank you {first name}! Next steps:

1. We prepare your jury profile from your LinkedIn: photo, role, a short bio and your experience.
2. I send it to you with the announcement post for your approval. Nothing is published before you say OK.
3. Then you get a private link. Sign in with the email it was sent to, and the profile is yours to edit any time.

Which email should I send the link to? And one question: should your role show your company's name, or only your title (for example "Product Designer")?`,
    },
    {
      kind: "template",
      language: "ka",
      heading: "Reply: says yes (Georgian)",
      body: `დიდი მადლობა, {სახელი}, ძალიან გამიხარდა! შემდეგი ნაბიჯები:

1. თქვენი LinkedIn-ის მიხედვით მოვამზადებთ ჟიურის პროფილს: ფოტო, პოზიცია, მოკლე ბიო და გამოცდილება.
2. პროფილს ანონსის პოსტთან ერთად დასამტკიცებლად გამოგიგზავნით. თქვენს თანხმობამდე არაფერი გამოქვეყნდება.
3. შემდეგ მიიღებთ პირად ბმულს. შედით იმ მეილით, რომელზეც ბმული მოგივათ, და პროფილი თქვენია, ნებისმიერ დროს შეგიძლიათ შეცვალოთ.

რომელ მეილზე გამოგიგზავნოთ ბმული? და კიდევ ერთი: პოზიციასთან ერთად კომპანიის სახელიც გამოჩნდეს, თუ მხოლოდ პოზიცია (მაგალითად „Product Designer“)?`,
    },
    {
      kind: "template",
      language: "en",
      heading: "Reply: asks how much time it takes",
      body: `Good question. Most jurors spend 10 to 15 minutes per site: open it on desktop and phone, look at the technical report, score it and leave a short comment.

We'd love around 5 to 15 sites a month, but it's up to you: score what you have time for. You get a daily email when there are new sites in the categories you follow, and a reminder a day before voting closes on a site you haven't scored yet.`,
    },
    {
      kind: "template",
      language: "ka",
      heading: "Reply: asks how much time it takes (Georgian)",
      body: `კარგი კითხვაა. ჟიურის წევრების უმეტესობას ერთ საიტზე 10–15 წუთი სჭირდება: გახსნით კომპიუტერზე და ტელეფონზე, გადახედავთ ტექნიკურ რეპორტს, დაწერთ ქულას და მოკლე კომენტარს.

კარგი იქნება თვეში 5–15 საიტი, მაგრამ ეს თქვენზეა: შეაფასეთ იმდენი, რამდენზეც დრო გაქვთ. ყოველდღიურ მეილს მიიღებთ, როცა თქვენთვის საინტერესო კატეგორიებში ახალი საიტები დაემატება, ხოლო თუ საიტი ჯერ არ შეგიფასებიათ, შეფასების დახურვამდე ერთი დღით ადრე შეგახსენებთ.`,
    },
    {
      kind: "template",
      language: "en",
      heading: "Reply: declines",
      body: `Completely understand, thank you for letting me know, {first name}. If things change, the door is open: just write here.

And if you or your team build a site you're proud of, you can submit it for free: https://www.shemoqmedi.space/submit`,
    },
    {
      kind: "template",
      language: "ka",
      heading: "Reply: declines (Georgian)",
      body: `სრულიად გასაგებია, მადლობა, რომ მომწერეთ, {სახელი}. თუ რამე შეიცვლება, კარი ღიაა, უბრალოდ აქ მომწერეთ.

და თუ თქვენ ან თქვენი გუნდი ისეთ საიტს შექმნით, რომლითაც ამაყობთ, შეგიძლიათ უფასოდ გამოგზავნოთ: https://www.shemoqmedi.space/submit`,
    },
    {
      kind: "template",
      language: "en",
      heading: "Follow-up: no reply after 5 to 7 days (send once)",
      body: `Hi {first name}, bringing this back up in case it got buried. No pressure at all: if jury work isn't for you right now, a quick "not now" is perfectly fine.

The details are here: ${JURY_GUIDE}`,
    },
    {
      kind: "template",
      language: "ka",
      heading: "Follow-up: no reply (Georgian, send once)",
      body: `გამარჯობა {სახელი}, წინა შეტყობინებას გახსენებთ, შეიძლება სხვა მესიჯებში დაიკარგა. არანაირი ზეწოლა: თუ ახლა ჟიურისთვის არ გცალიათ, მოკლე „ახლა არა“ სავსებით საკმარისია.

დეტალები აქ არის: ${JURY_GUIDE}`,
    },
    {
      kind: "steps",
      heading: "When they ask to show their employer's name",
      body: `We show a company name only when the person confirms it, in their own words. Their role is shown as their own role, not as a partnership with the company, and we never use company logos. If they'd rather not, the profile shows only their title.

Write down the exact wording they send and give it to Giorgi with their profile.`,
    },
    {
      kind: "template",
      language: "en",
      heading: "Reply: asks to show their employer's name",
      body: `Of course. I'll write your role exactly as you send it, for example "Senior Designer at {company}". It's shown as your own role, not as a partnership with the company, and we don't use company logos.

Please send me the exact wording you'd like. If you'd rather leave the company out, that's fine too: then only your title is shown.`,
    },
    {
      kind: "template",
      language: "ka",
      heading: "Reply: asks to show their employer's name (Georgian)",
      body: `რა თქმა უნდა. პოზიციას ზუსტად ისე დავწერ, როგორც გამომიგზავნით, მაგალითად „Senior Designer at {კომპანია}“. ეს ჩანს როგორც თქვენი პირადი პოზიცია და არა კომპანიასთან თანამშრომლობა, და კომპანიების ლოგოებს არ ვიყენებთ.

გთხოვთ, გამომიგზავნოთ ზუსტი ფორმულირება. თუ კომპანიის სახელი არ გინდათ, ესეც სავსებით კარგია: მაშინ მხოლოდ პოზიცია გამოჩნდება.`,
    },
    {
      kind: "steps",
      heading: "After each message",
      body: `1. Set the Status in your tab of the leads sheet (the dropdown) and fill in the date.
2. If they said yes, tell Giorgi right away with their email and how they want their role written. He makes the profile and sends it for approval.
3. If they didn't answer, put the follow-up date (5 to 7 days later) in the sheet. After the one follow-up, set the status and stop.`,
    },
  ],
};

const listingInvitations: StarterGuide = {
  slug: "listing-invitations",
  title: "Invite creators to submit their site",
  summary: "Messages that invite a site's creator to submit it, and replies to their usual questions.",
  area: "networking",
  roles: ["ops", "developer", "owner"],
  sections: [
    {
      kind: "steps",
      heading: "What we can promise, and what we can't",
      body: `- Submitting is free and takes 30 seconds: name, link and email at https://www.shemoqmedi.space/submit
- Editors review every site by hand. Accepted sites get a week of jury voting, then the results by email.
- Awards are earned, not bought. Nothing on Shemoqmedi can be paid for: no fee, no fast-track, no paid placement.
- Never promise that a site will be listed or win anything. The editors decide the listing, the jury decides the awards.
- Sites sent only for promotion or a backlink, and template sites without a creative idea, are declined. Don't invite those.`,
    },
    {
      kind: "steps",
      heading: "Before you send",
      body: `1. Open the site on your phone and on a computer. Invite it only if it is original work you'd be glad to see on Shemoqmedi.
2. Check it isn't already listed (search shemoqmedi.space) or already in the leads sheet.
3. Replace everything in {curly brackets} and name one specific thing you liked: the animation on the home page, the type, the case studies.
4. Talk about their site, not about where you found it, and don't mention other award sites.
5. The link in the templates is tagged (utm_source=linkedin), so we can count the submissions it brings. On another channel change "linkedin" to "instagram", "x", "email" or "reddit".`,
    },
    {
      kind: "template",
      language: "en",
      heading: "Invitation (English)",
      body: `Hi {first name}, I came across {site name} and really liked {one specific thing}. I'm Giorgi, founder of Shemoqmedi (shemoqmedi.space), an awards platform for web design: a jury of designers and developers scores each site, and the best win Site of the Day, Month and Year.

I think {site name} deserves the jury's eyes. Submitting is free and takes 30 seconds: ${SUBMIT}

Our editors review every site by hand, and accepted sites get a week of jury voting.`,
    },
    {
      kind: "template",
      language: "ka",
      heading: "Invitation (Georgian)",
      body: `გამარჯობა {სახელი}, ვნახე {საიტის სახელი} და ძალიან მომეწონა {ერთი კონკრეტული რამ}. მე გიორგი ვარ, Shemoqmedi-ს (shemoqmedi.space) დამფუძნებელი. ეს არის ვებდიზაინის დაჯილდოების პლატფორმა: დიზაინერებისა და დეველოპერების ჟიური აფასებს თითოეულ საიტს, საუკეთესოები კი იღებენ ჯილდოებს Site of the Day, Month და Year.

მგონია, {საიტის სახელი} ჟიურის ყურადღებას იმსახურებს. გამოგზავნა უფასოა და 30 წამი სჭირდება: ${SUBMIT}

ყველა საიტს ჩვენი რედაქტორები ხელით განიხილავენ, მიღებულ საიტებს კი ჟიური ერთი კვირის განმავლობაში აფასებს.`,
    },
    {
      kind: "template",
      language: "en",
      heading: "Product Hunt: comment on the launch (no link)",
      body: `Congrats on the launch! {One specific thing you liked about the site}. Really well done.`,
    },
    {
      kind: "steps",
      heading: "Product Hunt and other launch sites",
      body: `Comment on the launch first, with something true and specific. Don't put our link in public comments: it reads as spam. Then send the invitation to the maker on LinkedIn or X, from their profile.`,
    },
    {
      kind: "template",
      language: "en",
      heading: "Reply: \"Is it free?\"",
      body: `Yes, completely. Nothing on Shemoqmedi can be paid for: no fee, no fast-track, no paid placement. Awards are earned, not bought. Our editors review every site by hand, and the jury decides the awards.`,
    },
    {
      kind: "template",
      language: "ka",
      heading: "Reply: \"Is it free?\" (Georgian)",
      body: `დიახ, სრულიად უფასოა. Shemoqmedi-ზე ვერაფერს იყიდით: არც საფასური, არც დაჩქარება, არც ფასიანი განთავსება. ჯილდოებს იმსახურებენ და არა ყიდულობენ. ყველა საიტს ჩვენი რედაქტორები ხელით განიხილავენ, ჯილდოებს კი ჟიური წყვეტს.`,
    },
    {
      kind: "template",
      language: "en",
      heading: "Reply: \"Will it win?\"",
      body: `I can't promise that, and nobody can: the editors decide which sites are listed, and only the jury decides the awards. What I can say is that {site name} is the kind of work we'd love the jury to see.`,
    },
    {
      kind: "template",
      language: "ka",
      heading: "Reply: \"Will it win?\" (Georgian)",
      body: `ამას ვერ დაგპირდებით და ვერავინ დაგპირდებათ: რომელი საიტი განთავსდება, რედაქტორები წყვეტენ, ჯილდოებს კი მხოლოდ ჟიური. რისი თქმაც შემიძლია: {საიტის სახელი} ზუსტად ისეთი ნამუშევარია, რომლის ნახვაც ჟიურისთვის გვინდა.`,
    },
    {
      kind: "template",
      language: "en",
      heading: "Reply: they submitted",
      body: `Thank you, {first name}! It's in. Our editors review it by hand; if it's accepted, it gets a week of jury voting, and you'll get the results by email.`,
    },
    {
      kind: "template",
      language: "ka",
      heading: "Reply: they submitted (Georgian)",
      body: `დიდი მადლობა, {სახელი}! მივიღეთ. რედაქტორები ხელით განიხილავენ; თუ საიტი მიიღება, ჟიური მას ერთი კვირის განმავლობაში შეაფასებს, შედეგებს კი მეილზე მიიღებთ.`,
    },
    {
      kind: "template",
      language: "en",
      heading: "Follow-up: no reply after 5 to 7 days (send once)",
      body: `Hi {first name}, bringing this back up in case it got buried. If you'd like the jury to see {site name}, it takes 30 seconds: ${SUBMIT}`,
    },
    {
      kind: "template",
      language: "ka",
      heading: "Follow-up: no reply (Georgian, send once)",
      body: `გამარჯობა {სახელი}, წინა შეტყობინებას გახსენებთ, შეიძლება დაიკარგა. თუ გინდათ, რომ ჟიურიმ {საიტის სახელი} ნახოს, ამას 30 წამი სჭირდება: ${SUBMIT}`,
    },
  ],
};

const findingLeads: StarterGuide = {
  slug: "finding-leads",
  title: "Find good sites and creators, and log the lead",
  summary: "Where to look for sites worth inviting and for jury candidates, and how to add them to the leads sheet.",
  area: "networking",
  roles: ["ops", "developer"],
  sections: [
    {
      kind: "steps",
      heading: "What a good lead looks like",
      body: `A site:
- Original, creative work: its own design idea, not a template with the logo changed.
- Works on a phone and on a computer, and loads.
- Made by someone you can reach: the studio, the developer or the founder.
- Not a site made only to sell something or to get a backlink. Those are declined.
- Not already on shemoqmedi.space and not already in the leads sheet.

A jury candidate:
- A designer, developer, founder or content person whose own work is good, and who is active on LinkedIn.
- Not one of Giorgi's own connections (those are his to message).`,
    },
    {
      kind: "steps",
      heading: "Where to look",
      body: `The "Sources" tab of the leads sheet lists every source with what to look for and how to contact people there. The ones that work best:

- Product Hunt (daily): today's launches with well-designed landing pages. Open the maker's profile for their LinkedIn or X.
- Hacker News "Show HN", Peerlist, Uneed, Microlaunch, BetaList, DevHunt (weekly): makers posting their own products and sites.
- Reddit: "Showoff Saturday" on r/webdev every Saturday, r/web_design, r/threejs for 3D and WebGL sites.
- Awwwards, Behance and Dribbble: browse for web projects that link to a live site, then find the studio or designer. Use them only to find people. Never copy their screenshots or text: we make our own.
- LinkedIn: posts like "we just launched our new website", and searches such as "web designer Georgia", "creative developer", "Webflow developer". Studios in Georgia are a priority.`,
    },
    {
      kind: "steps",
      heading: "Log a site lead (Listings tab)",
      body: `1. Search the sheet first (the "Search tasks" tab, or Ctrl+F) so nobody gets the same message twice.
2. Add a row on the "Listings" tab: Site name, Site URL, Owner or creator, LinkedIn, Company profile, Country, Segment, Where found.
3. Email: only an address they publish themselves (the site's footer or contact page). Leave Phone empty unless Giorgi asks for it.
4. Status: "To contact". When you send the invitation, change the Status from the dropdown and fill in "Contacted on".
5. Notes: anything Giorgi should know, for example "template site?" or "owner name guessed from LinkedIn URL, check".`,
    },
    {
      kind: "steps",
      heading: "Log a jury lead (Leads tab)",
      body: `1. Search the sheet first.
2. Add a row on the "Leads" tab: Name, Role / title, Company or studio, Country, Segment, Where found, LinkedIn URL, Website or portfolio. Status: "To contact".
3. Giorgi splits new leads between "dimas task" and "sabas task". Work only from your own tab.
4. When you send: set the Status, fill "Contacted on", "Contacted by" (your name) and "Template used", and put "Follow-up on" 5 to 7 days later.
5. Use the messages in the guide "Jury invitations: first message and replies". The DM saved in the sheet says scoring takes "a few minutes"; the live guide says 10 to 15 minutes per site, so use the guide's version.`,
    },
    {
      kind: "steps",
      heading: "Daily limits and manners",
      body: `- About 15 to 20 new connection requests a day. LinkedIn limits how many invitations an account can send each week, and Giorgi's account must stay in good standing.
- Message people one by one, by hand. No automation tools, no copy-paste to a whole list at once.
- If someone asks not to be contacted again, write "Do not contact" in their row and never message them again.
- When anyone replies, tell Giorgi the same day.`,
    },
  ],
};

export const GUIDE_STARTERS: readonly StarterGuide[] = [juryInvitations, listingInvitations, findingLeads];
