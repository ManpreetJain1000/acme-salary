'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** Reference data changes only on deploy: fetch once, cache forever. */
export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: Infinity });
}

/** Derived lookup helpers so components don't re-implement them. */
export function useMetaLookups() {
  const { data } = useMeta();
  const countryName = (code: string) => data?.countries.find((c) => c.code === code)?.name ?? code;
  const currencyFor = (code: string) => data?.countries.find((c) => c.code === code)?.currency;
  const titlesFor = (department?: string | null) =>
    department
      ? data?.departments.find((d) => d.name === department)?.jobTitles ?? []
      : data?.departments.flatMap((d) => d.jobTitles) ?? [];
  return { meta: data, countryName, currencyFor, titlesFor };
}
