'use client';

import { BarChart } from '@mantine/charts';
import {
  Alert,
  Badge,
  Card,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconInfoCircle } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { EmployeeDrawer } from '@/components/EmployeeDrawer';
import { FilterBar } from '@/components/FilterBar';
import { api } from '@/lib/api';
import { formatCount, formatMoney, formatPercent, formatUsd } from '@/lib/format';
import { useMetaLookups } from '@/lib/hooks';
import type { Breakdown, InsightFilter } from '@/lib/types';

const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } as const;
const usdCompact = (v: number) => formatUsd(v * 100, { compact: true });

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <div>
          <Title order={4}>{title}</Title>
          <Text size="sm" c="dimmed">
            {subtitle}
          </Text>
        </div>
        {children}
      </Stack>
    </Paper>
  );
}

function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card withBorder radius="md" padding="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="1.75rem" fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Card>
  );
}

/** Single-series horizontal bars: one hue, hover tooltip, title names the measure. */
function BreakdownChart({ rows }: { rows: Breakdown[] }) {
  const data = rows.map((r) => ({ label: r.label, payroll: Math.round(r.totalUsdMinor / 100) }));
  return (
    <BarChart
      h={Math.max(160, rows.length * 34)}
      data={data}
      dataKey="label"
      orientation="vertical"
      yAxisProps={{ width: 130 }}
      series={[{ name: 'payroll', label: 'Annual payroll (USD)', color: 'indigo.6' }]}
      valueFormatter={usdCompact}
      gridAxis="none"
      barProps={{ radius: 4 }}
                maxBarWidth={22}
    />
  );
}

function BreakdownTable({ rows }: { rows: Breakdown[] }) {
  return (
    <Table striped verticalSpacing={6} fz="sm">
      <Table.Thead>
        <Table.Tr>
          <Table.Th />
          <Table.Th style={num}>Headcount</Table.Th>
          <Table.Th style={num}>Payroll (USD)</Table.Th>
          <Table.Th style={num}>Median (USD)</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((r) => (
          <Table.Tr key={r.key}>
            <Table.Td>{r.label}</Table.Td>
            <Table.Td style={num}>{formatCount(r.headcount)}</Table.Td>
            <Table.Td style={num}>{formatUsd(r.totalUsdMinor, { compact: true })}</Table.Td>
            <Table.Td style={num}>{formatUsd(r.medianUsdMinor)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

const THRESHOLDS = [
  { value: '0.25', label: '±25%' },
  { value: '0.4', label: '±40%' },
  { value: '0.6', label: '±60%' },
];

export default function InsightsPage() {
  const { meta, countryName } = useMetaLookups();
  const [filters, setFilters] = useState<InsightFilter>({});
  const [threshold, setThreshold] = useState('0.4');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const summary = useQuery({ queryKey: ['summary', filters], queryFn: () => api.summary(filters) });
  const bands = useQuery({ queryKey: ['payBands', filters], queryFn: () => api.payBands(filters) });
  const outliers = useQuery({
    queryKey: ['outliers', filters, threshold],
    queryFn: () => api.outliers({ ...filters, threshold: Number(threshold) }),
  });

  const s = summary.data;
  const anyError = summary.error ?? bands.error ?? outliers.error;
  // With one job title selected, compare that role's median across countries (Q2).
  const titleComparison =
    filters.jobTitle && bands.data && bands.data.length > 1
      ? [...bands.data]
          .sort((a, b) => b.medianUsdMinor - a.medianUsdMinor)
          .map((b) => ({ country: b.countryName, median: Math.round(b.medianUsdMinor / 100) }))
      : null;

  return (
    <Stack gap="md">
      <div>
        <Title order={2}>Pay insights</Title>
        <Text c="dimmed" size="sm">
          How ACME pays its current employees. Cross-country figures are converted to USD at static rates as of{' '}
          {meta?.fxAsOf ?? '…'}.
        </Text>
      </div>

      <FilterBar value={filters} onChange={setFilters} />

      {anyError && (
        <Alert color="red" icon={<IconAlertCircle />} title="Couldn't load insights">
          {anyError.message}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        {s ? (
          <>
            <StatTile label="Headcount" value={formatCount(s.headcount)} />
            <StatTile
              label="Annual payroll"
              value={formatUsd(s.totalPayrollUsdMinor, { compact: true })}
              hint="USD-normalised"
            />
            <StatTile
              label="Median salary"
              value={s.medianUsdMinor === null ? '—' : formatUsd(s.medianUsdMinor)}
              hint="USD-normalised"
            />
          </>
        ) : (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} h={96} radius="md" />)
        )}
      </SimpleGrid>

      {s && s.headcount === 0 ? (
        <Alert icon={<IconInfoCircle />} title="No employees match these filters">
          Clear a filter to see insights.
        </Alert>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            <Section title="Where payroll goes: by country" subtitle="Total annual payroll, USD-normalised">
              {s ? <BreakdownChart rows={s.byCountry} /> : <Skeleton h={300} />}
              {s && <BreakdownTable rows={s.byCountry} />}
            </Section>
            <Section title="Where payroll goes: by department" subtitle="Total annual payroll, USD-normalised">
              {s ? <BreakdownChart rows={s.byDepartment} /> : <Skeleton h={300} />}
              {s && <BreakdownTable rows={s.byDepartment} />}
            </Section>
          </SimpleGrid>

          <Section
            title="Pay bands by role and country"
            subtitle={
              filters.jobTitle
                ? `What we pay a ${filters.jobTitle} in each country`
                : 'Pick a job title above to compare one role across countries. Amounts in local currency.'
            }
          >
            {titleComparison && (
              <BarChart
                h={Math.max(160, titleComparison.length * 34)}
                data={titleComparison}
                dataKey="country"
                orientation="vertical"
                yAxisProps={{ width: 130 }}
                series={[{ name: 'median', label: 'Median salary (USD)', color: 'indigo.6' }]}
                valueFormatter={usdCompact}
                gridAxis="none"
                barProps={{ radius: 4 }}
                maxBarWidth={22}
              />
            )}
            {bands.isPending ? (
              <Skeleton h={240} />
            ) : (
              <Table.ScrollContainer minWidth={900} mah={480}>
                <Table striped stickyHeader verticalSpacing={6} fz="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Country</Table.Th>
                      <Table.Th>Job title</Table.Th>
                      <Table.Th style={num}>People</Table.Th>
                      <Table.Th style={num}>Min</Table.Th>
                      <Table.Th style={num}>25th pct</Table.Th>
                      <Table.Th style={num}>Median</Table.Th>
                      <Table.Th style={num}>75th pct</Table.Th>
                      <Table.Th style={num}>Max</Table.Th>
                      <Table.Th style={num}>Median (USD)</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {bands.data?.map((b) => (
                      <Table.Tr key={`${b.country}-${b.jobTitle}-${b.currency}`}>
                        <Table.Td>{b.countryName}</Table.Td>
                        <Table.Td>{b.jobTitle}</Table.Td>
                        <Table.Td style={num}>{b.count}</Table.Td>
                        <Table.Td style={num}>{formatMoney(b.min, b.currency)}</Table.Td>
                        <Table.Td style={num}>{formatMoney(b.p25, b.currency)}</Table.Td>
                        <Table.Td style={{ ...num, fontWeight: 600 }}>{formatMoney(b.median, b.currency)}</Table.Td>
                        <Table.Td style={num}>{formatMoney(b.p75, b.currency)}</Table.Td>
                        <Table.Td style={num}>{formatMoney(b.max, b.currency)}</Table.Td>
                        <Table.Td style={num}>{formatUsd(b.medianUsdMinor)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Section>

          <Section
            title="Who is paid unusually high or low?"
            subtitle="Employees whose salary differs from the median of people with the same job title in the same country (groups of 5+). Click a row to review."
          >
            <Group justify="space-between">
              <SegmentedControl data={THRESHOLDS} value={threshold} onChange={setThreshold} />
              {outliers.data && (
                <Text size="sm" c="dimmed">
                  {formatCount(outliers.data.total)} flagged
                  {outliers.data.total > outliers.data.data.length && `, showing the ${outliers.data.data.length} largest gaps`}
                </Text>
              )}
            </Group>
            {outliers.isPending ? (
              <Skeleton h={200} />
            ) : outliers.data?.total === 0 ? (
              <Text size="sm" c="dimmed">
                Nobody is outside ±{Math.round(Number(threshold) * 100)}% of their group median.
              </Text>
            ) : (
              <Table.ScrollContainer minWidth={820} mah={420}>
                <Table highlightOnHover stickyHeader verticalSpacing={6} fz="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Employee</Table.Th>
                      <Table.Th>Job title</Table.Th>
                      <Table.Th>Country</Table.Th>
                      <Table.Th style={num}>Salary</Table.Th>
                      <Table.Th style={num}>Group median</Table.Th>
                      <Table.Th style={num}>Difference</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {outliers.data?.data.map((o) => (
                      <Table.Tr key={o.id} onClick={() => setSelectedId(o.id)} style={{ cursor: 'pointer' }}>
                        <Table.Td>
                          {o.fullName}{' '}
                          <Text span size="xs" c="dimmed">
                            {o.employeeCode}
                          </Text>
                        </Table.Td>
                        <Table.Td>{o.jobTitle}</Table.Td>
                        <Table.Td>{countryName(o.country)}</Table.Td>
                        <Table.Td style={num}>{formatMoney(o.salaryMinor, o.currency)}</Table.Td>
                        <Table.Td style={num}>
                          {formatMoney(o.groupMedianMinor, o.currency)}{' '}
                          <Text span size="xs" c="dimmed">
                            (n={o.groupSize})
                          </Text>
                        </Table.Td>
                        <Table.Td style={num}>
                          <Badge variant="light" color={o.deviation > 0 ? 'orange' : 'blue'}>
                            {o.deviation > 0 ? 'Above' : 'Below'} {formatPercent(o.deviation, { signed: true })}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Section>
        </>
      )}

      <EmployeeDrawer employeeId={selectedId} onClose={() => setSelectedId(null)} />
    </Stack>
  );
}
