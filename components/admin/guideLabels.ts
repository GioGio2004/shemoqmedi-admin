// Names the admin shows for guide areas and roles (convex/schema.ts guideArea / guideRole).

export const GUIDE_AREAS = [
  { value: "networking", label: "Networking" },
  { value: "social", label: "Social" },
  { value: "listings", label: "Listings" },
  { value: "jury", label: "Jury" },
  { value: "operations", label: "Operations" },
] as const;

export const GUIDE_ROLES = [
  { value: "everyone", label: "Everyone" },
  { value: "owner", label: "Owner" },
  { value: "developer", label: "Developer" },
  { value: "ops", label: "Ops assistant" },
] as const;

export type GuideArea = (typeof GUIDE_AREAS)[number]["value"];
export type GuideRole = (typeof GUIDE_ROLES)[number]["value"];

export const areaLabel = (area: string) => GUIDE_AREAS.find((a) => a.value === area)?.label ?? area;
export const roleLabel = (role: string) => GUIDE_ROLES.find((r) => r.value === role)?.label ?? role;
