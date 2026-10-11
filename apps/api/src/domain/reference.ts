/**
 * Reference data: countries, currencies, departments and job titles.
 *
 * Kept in code (not the DB) because it changes with releases, not with HR edits,
 * and it is the single source of truth for validation, the seed and the UI dropdowns.
 */

export type CurrencyCode = 'USD' | 'GBP' | 'EUR' | 'INR' | 'CAD' | 'AUD' | 'SGD' | 'BRL';

export interface Currency {
  code: CurrencyCode;
  /** USD value of one major unit of this currency. */
  usdRate: number;
}

/**
 * Static, dated FX rates (illustrative). Deliberately not live: see decisions.md D4.
 * All supported currencies use 2 minor-unit digits, so minor units convert directly.
 */
export const FX_AS_OF = '2026-10-01';

export const CURRENCIES: readonly Currency[] = [
  { code: 'USD', usdRate: 1 },
  { code: 'GBP', usdRate: 1.33 },
  { code: 'EUR', usdRate: 1.16 },
  { code: 'INR', usdRate: 0.0113 },
  { code: 'CAD', usdRate: 0.72 },
  { code: 'AUD', usdRate: 0.66 },
  { code: 'SGD', usdRate: 0.77 },
  { code: 'BRL', usdRate: 0.18 },
];

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as [CurrencyCode, ...CurrencyCode[]];

export interface Country {
  code: string;
  name: string;
  currency: CurrencyCode;
  /** Pay level relative to the US market; used only by the seed. */
  payMultiplier: number;
  /** Relative headcount weight; used only by the seed. */
  headcountWeight: number;
}

export const COUNTRIES: readonly Country[] = [
  { code: 'US', name: 'United States', currency: 'USD', payMultiplier: 1.0, headcountWeight: 30 },
  { code: 'IN', name: 'India', currency: 'INR', payMultiplier: 0.28, headcountWeight: 25 },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', payMultiplier: 0.8, headcountWeight: 10 },
  { code: 'DE', name: 'Germany', currency: 'EUR', payMultiplier: 0.8, headcountWeight: 8 },
  { code: 'CA', name: 'Canada', currency: 'CAD', payMultiplier: 0.8, headcountWeight: 6 },
  { code: 'BR', name: 'Brazil', currency: 'BRL', payMultiplier: 0.35, headcountWeight: 6 },
  { code: 'FR', name: 'France', currency: 'EUR', payMultiplier: 0.72, headcountWeight: 4 },
  { code: 'AU', name: 'Australia', currency: 'AUD', payMultiplier: 0.82, headcountWeight: 4 },
  { code: 'SG', name: 'Singapore', currency: 'SGD', payMultiplier: 0.85, headcountWeight: 4 },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', payMultiplier: 0.8, headcountWeight: 3 },
];

export const COUNTRY_CODES = COUNTRIES.map((c) => c.code) as [string, ...string[]];

export type Level = 1 | 2 | 3 | 4;

/** Annual base pay band in USD (major units) for each level, US market. */
export const LEVEL_BANDS_USD: Record<Level, { min: number; max: number }> = {
  1: { min: 40_000, max: 60_000 },
  2: { min: 60_000, max: 100_000 },
  3: { min: 95_000, max: 145_000 },
  4: { min: 140_000, max: 210_000 },
};

export interface Department {
  name: string;
  headcountWeight: number;
  titles: readonly { title: string; level: Level }[];
}

export const DEPARTMENTS: readonly Department[] = [
  {
    name: 'Engineering',
    headcountWeight: 35,
    titles: [
      { title: 'Software Engineer', level: 2 },
      { title: 'Senior Software Engineer', level: 3 },
      { title: 'Staff Engineer', level: 4 },
      { title: 'Engineering Manager', level: 4 },
      { title: 'QA Engineer', level: 2 },
    ],
  },
  {
    name: 'Sales',
    headcountWeight: 15,
    titles: [
      { title: 'Sales Development Rep', level: 1 },
      { title: 'Account Executive', level: 2 },
      { title: 'Sales Manager', level: 3 },
    ],
  },
  {
    name: 'Customer Support',
    headcountWeight: 12,
    titles: [
      { title: 'Support Specialist', level: 1 },
      { title: 'Support Team Lead', level: 2 },
    ],
  },
  {
    name: 'Operations',
    headcountWeight: 10,
    titles: [
      { title: 'Operations Associate', level: 1 },
      { title: 'Operations Manager', level: 3 },
    ],
  },
  {
    name: 'Product',
    headcountWeight: 8,
    titles: [
      { title: 'Product Designer', level: 2 },
      { title: 'Product Manager', level: 3 },
      { title: 'Senior Product Manager', level: 4 },
    ],
  },
  {
    name: 'Marketing',
    headcountWeight: 7,
    titles: [
      { title: 'Marketing Specialist', level: 2 },
      { title: 'Marketing Manager', level: 3 },
    ],
  },
  {
    name: 'People',
    headcountWeight: 7,
    titles: [
      { title: 'Recruiter', level: 2 },
      { title: 'HR Generalist', level: 2 },
      { title: 'HR Manager', level: 3 },
    ],
  },
  {
    name: 'Finance',
    headcountWeight: 6,
    titles: [
      { title: 'Financial Analyst', level: 2 },
      { title: 'Finance Manager', level: 3 },
    ],
  },
];

export const DEPARTMENT_NAMES = DEPARTMENTS.map((d) => d.name) as [string, ...string[]];
export const JOB_TITLES = DEPARTMENTS.flatMap((d) => d.titles.map((t) => t.title)) as [
  string,
  ...string[],
];

export function countryByCode(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}
