'use client';

import { Group, Select } from '@mantine/core';
import { useMetaLookups } from '@/lib/hooks';
import type { InsightFilter } from '@/lib/types';

interface Props {
  value: InsightFilter;
  onChange: (next: InsightFilter) => void;
  children?: React.ReactNode;
}

/** Country / department / job title filters shared by the directory and insights. */
export function FilterBar({ value, onChange, children }: Props) {
  const { meta, titlesFor } = useMetaLookups();

  return (
    <Group gap="sm" align="flex-end" wrap="wrap">
      {children}
      <Select
        label="Country"
        placeholder="All countries"
        clearable
        searchable
        w={190}
        data={meta?.countries.map((c) => ({ value: c.code, label: c.name })) ?? []}
        value={value.country ?? null}
        onChange={(v) => onChange({ ...value, country: v ?? undefined })}
      />
      <Select
        label="Department"
        placeholder="All departments"
        clearable
        w={190}
        data={meta?.departments.map((d) => d.name) ?? []}
        value={value.department ?? null}
        onChange={(v) => {
          // Clear a job title that doesn't belong to the newly chosen department.
          const keepTitle = v && value.jobTitle && titlesFor(v).includes(value.jobTitle);
          onChange({ ...value, department: v ?? undefined, jobTitle: keepTitle ? value.jobTitle : undefined });
        }}
      />
      <Select
        label="Job title"
        placeholder="All job titles"
        clearable
        searchable
        w={230}
        data={titlesFor(value.department)}
        value={value.jobTitle ?? null}
        onChange={(v) => onChange({ ...value, jobTitle: v ?? undefined })}
      />
    </Group>
  );
}
