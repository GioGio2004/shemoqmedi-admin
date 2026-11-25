// A juror's Experience and Education lists, LinkedIn style: tidied, checked
// and sorted newest first before they are saved (jury.ts updateProfile,
// createJuror, updateJuror). Pure functions, so tests can call them directly.

import type { Infer } from "convex/values";
import type { juryEducation, juryExperience } from "../schema";
import { cleanText, fail, normalizeUrl } from "./listingHelpers";
import { LIMITS } from "./taxonomy";

export type ExperienceRow = Infer<typeof juryExperience>;
export type EducationRow = Infer<typeof juryEducation>;

/** Trims each line and collapses spaces, keeps line breaks (bullet lists), at most one blank line. */
function cleanMultiline(value: string, field: string, max: number) {
  const text = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/[^\S\n]+/g, " "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > max) fail(`${field} must be ${max} characters or fewer.`);
  return text;
}

function checkYear(year: number | undefined, field: string, latest: number) {
  if (year === undefined) return undefined;
  if (!Number.isInteger(year) || year < LIMITS.juryEarliestYear || year > latest) {
    fail(`${field} must be a year between ${LIMITS.juryEarliestYear} and ${latest}.`);
  }
  return year;
}

function checkMonth(month: number | undefined, year: number | undefined, field: string) {
  if (month === undefined) return undefined;
  if (!Number.isInteger(month) || month < 1 || month > 12) fail(`${field} must be a month from 1 to 12.`);
  if (year === undefined) fail(`${field} needs a year.`);
  return month;
}

/** Months since year 0, for comparing dates. A missing month counts as the given fallback. */
function monthIndex(year: number, month: number | undefined, fallback: number) {
  return year * 12 + (month ?? fallback) - 1;
}

/**
 * Newest first: roles they still hold, then by end date, then by start date.
 * Undated rows (no start year, older free-text `period` ones) keep their order, after the dated ones.
 */
export function sortExperience(rows: ExperienceRow[]): ExperienceRow[] {
  const endKey = (r: ExperienceRow) =>
    r.current ? Infinity : r.endYear !== undefined ? monthIndex(r.endYear, r.endMonth, 12) : -Infinity;
  const startKey = (r: ExperienceRow) => (r.startYear !== undefined ? monthIndex(r.startYear, r.startMonth, 1) : -Infinity);
  const dated = rows.filter((r) => r.startYear !== undefined);
  const undated = rows.filter((r) => r.startYear === undefined);
  // An ended role with only a start date sorts by its start.
  const sortEnd = (r: ExperienceRow) => (endKey(r) === -Infinity ? startKey(r) : endKey(r));
  dated.sort((a, b) => sortEnd(b) - sortEnd(a) || startKey(b) - startKey(a));
  return [...dated, ...undated];
}

/**
 * Tidies the Experience list: trims, drops empty rows, checks dates, caps the
 * count and sorts newest first. [] clears it (undefined).
 * `now` is the current time, for the latest allowed year.
 */
export function cleanExperience(rows: ExperienceRow[], now = Date.now()): ExperienceRow[] | undefined {
  const thisYear = new Date(now).getUTCFullYear();
  const nowIndex = monthIndex(thisYear, new Date(now).getUTCMonth() + 1, 1);
  const out: ExperienceRow[] = [];
  for (const r of rows) {
    const title = cleanText(r.title, "Experience role", 80, false);
    const organization = cleanText(r.organization, "Experience company", 80, false);
    const organizationUrl = r.organizationUrl?.trim() ? normalizeUrl(r.organizationUrl, "Company website") : undefined;
    const location = cleanText(r.location ?? "", "Experience location", 80, false) || undefined;
    const description =
      cleanMultiline(r.description ?? "", "Experience description", LIMITS.juryExperienceDescription) || undefined;
    const period = cleanText(r.period ?? "", "Experience period", 40, false) || undefined;
    const hasDates = r.startYear !== undefined || r.endYear !== undefined;
    // Fully empty rows are dropped; a row with anything in it must be complete.
    if (!title && !organization && !organizationUrl && !location && !description && !hasDates && !r.current) continue;
    const label = title || organization || "an experience entry";
    if (!title || !organization) fail("Each experience entry needs a role and a company.");

    const startYear = checkYear(r.startYear, `Start year for ${label}`, thisYear);
    const startMonth = checkMonth(r.startMonth, startYear, `Start month for ${label}`);
    const current = r.current === true;
    // A role they still hold has no end date.
    const endYear = current ? undefined : checkYear(r.endYear, `End year for ${label}`, thisYear);
    const endMonth = current ? undefined : checkMonth(r.endMonth, endYear, `End month for ${label}`);
    if ((current || endYear !== undefined) && startYear === undefined) fail(`Add the start year for ${label}.`);
    if (startYear !== undefined && monthIndex(startYear, startMonth, 1) > nowIndex) {
      fail(`${label} starts in the future.`);
    }
    if (startYear !== undefined && endYear !== undefined) {
      if (monthIndex(endYear, endMonth, 12) < monthIndex(startYear, startMonth, 1)) fail(`${label} ends before it starts.`);
    }

    out.push({
      title,
      organization,
      ...(organizationUrl ? { organizationUrl } : {}),
      ...(location ? { location } : {}),
      ...(startYear !== undefined ? { startYear } : {}),
      ...(startMonth !== undefined ? { startMonth } : {}),
      ...(endYear !== undefined ? { endYear } : {}),
      ...(endMonth !== undefined ? { endMonth } : {}),
      ...(current ? { current: true } : {}),
      ...(description ? { description } : {}),
      // The free-text period only stays on rows without real dates.
      ...(period && startYear === undefined ? { period } : {}),
    });
  }
  if (out.length > LIMITS.juryExperience) fail(`Add up to ${LIMITS.juryExperience} experience entries.`);
  return out.length ? sortExperience(out) : undefined;
}

/** Tidies the Education list: school required, years checked, newest first. [] clears it (undefined). */
export function cleanEducation(rows: EducationRow[], now = Date.now()): EducationRow[] | undefined {
  const thisYear = new Date(now).getUTCFullYear();
  const out: EducationRow[] = [];
  for (const r of rows) {
    const school = cleanText(r.school, "School", 100, false);
    const degree = cleanText(r.degree ?? "", "Degree", 80, false) || undefined;
    const field = cleanText(r.field ?? "", "Field of study", 80, false) || undefined;
    if (!school && !degree && !field && r.startYear === undefined && r.endYear === undefined) continue;
    if (!school) fail("Each education entry needs a school.");
    const startYear = checkYear(r.startYear, `Start year for ${school}`, thisYear);
    // The end year may be an expected graduation a few years ahead.
    const endYear = checkYear(r.endYear, `End year for ${school}`, thisYear + 8);
    if (startYear !== undefined && endYear !== undefined && endYear < startYear) fail(`${school} ends before it starts.`);
    out.push({
      school,
      ...(degree ? { degree } : {}),
      ...(field ? { field } : {}),
      ...(startYear !== undefined ? { startYear } : {}),
      ...(endYear !== undefined ? { endYear } : {}),
    });
  }
  if (out.length > LIMITS.juryEducation) fail(`Add up to ${LIMITS.juryEducation} education entries.`);
  if (!out.length) return undefined;
  const key = (r: EducationRow) => r.endYear ?? r.startYear ?? -Infinity;
  return out.sort((a, b) => key(b) - key(a));
}
