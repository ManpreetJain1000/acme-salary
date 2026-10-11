'use client';

import {
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Modal,
  Pagination,
  Paper,
  SegmentedControl,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronUp,
  IconPlus,
  IconSearch,
  IconSelector,
} from '@tabler/icons-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EmployeeDrawer } from '@/components/EmployeeDrawer';
import { EmployeeForm } from '@/components/EmployeeForm';
import { FilterBar } from '@/components/FilterBar';
import { api } from '@/lib/api';
import { formatCount, formatMoney, formatUsd } from '@/lib/format';
import { useMetaLookups } from '@/lib/hooks';
import type { EmployeeQuery, EmployeeStatus, InsightFilter } from '@/lib/types';

const PAGE_SIZE = 25;

function countLabel(n: number, status: EmployeeStatus | 'all', filtered: boolean): string {
  const noun = n === 1 ? 'employee' : 'employees';
  if (filtered) return `${formatCount(n)} matching`;
  if (status === 'all') return `${formatCount(n)} ${noun}, current and former`;
  return `${formatCount(n)} ${status === 'active' ? 'current' : 'former'} ${noun}`;
}

type SortKey = 'fullName' | 'jobTitle' | 'department' | 'country' | 'salary' | 'hireDate';

function SortHeader({
  label,
  field,
  sort,
  onSort,
  align,
}: {
  label: string;
  field: SortKey;
  sort: { by: string; dir: 'asc' | 'desc' };
  onSort: (field: SortKey) => void;
  align?: 'right';
}) {
  const active = sort.by === field;
  const Icon = !active ? IconSelector : sort.dir === 'asc' ? IconChevronUp : IconChevronDown;
  return (
    <Table.Th style={{ textAlign: align }} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <UnstyledButton onClick={() => onSort(field)}>
        <Group gap={4} wrap="nowrap" justify={align === 'right' ? 'flex-end' : 'flex-start'}>
          <Text fw={600} size="sm">
            {label}
          </Text>
          <Icon size={14} />
        </Group>
      </UnstyledButton>
    </Table.Th>
  );
}

export default function EmployeesPage() {
  const queryClient = useQueryClient();
  const { meta, countryName } = useMetaLookups();
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search.trim(), 300);
  const [filters, setFilters] = useState<InsightFilter>({});
  const [status, setStatus] = useState<EmployeeStatus | 'all'>('active');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ by: SortKey; dir: 'asc' | 'desc' }>({ by: 'fullName', dir: 'asc' });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const query: EmployeeQuery = {
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
    ...filters,
    sortBy: sort.by,
    sortDir: sort.dir,
    status,
  };

  const list = useQuery({
    queryKey: ['employees', query],
    queryFn: () => api.listEmployees(query),
    placeholderData: keepPreviousData, // no flash of empty table while paging
  });

  const create = useMutation({
    mutationFn: api.createEmployee,
    onSuccess: async (created) => {
      setCreating(false);
      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'meta' });
      notifications.show({ color: 'green', message: `${created.fullName} added (${created.employeeCode})` });
      setSelectedId(created.id);
    },
  });

  const onSort = (field: SortKey) => {
    setSort((s) => ({ by: field, dir: s.by === field && s.dir === 'asc' ? 'desc' : 'asc' }));
    setPage(1);
  };

  const data = list.data;
  const hasFilters = Boolean(debouncedSearch || filters.country || filters.department || filters.jobTitle);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Employees</Title>
          <Text c="dimmed" size="sm">
            {data
              ? countLabel(data.total, status, hasFilters)
              : 'Loading…'}
            {meta && ` · USD values at static rates as of ${meta.fxAsOf}`}
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
          Add employee
        </Button>
      </Group>

      <FilterBar
        value={filters}
        onChange={(f) => {
          setFilters(f);
          setPage(1);
        }}
      >
        <TextInput
          label="Search"
          placeholder="Name, email or employee code"
          leftSection={<IconSearch size={16} />}
          w={260}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            setPage(1);
          }}
        />
        <SegmentedControl
          aria-label="Employment status"
          data={[
            { value: 'active', label: 'Current' },
            { value: 'terminated', label: 'Former' },
            { value: 'all', label: 'All' },
          ]}
          value={status}
          onChange={(v) => {
            setStatus(v as EmployeeStatus | 'all');
            setPage(1);
          }}
        />
      </FilterBar>

      {list.isError && (
        <Alert color="red" icon={<IconAlertCircle />} title="Couldn't load employees">
          {list.error.message}{' '}
          <Button variant="subtle" size="compact-sm" onClick={() => list.refetch()}>
            Retry
          </Button>
        </Alert>
      )}

      <Paper withBorder radius="md">
        <Table.ScrollContainer minWidth={820}>
          <Table highlightOnHover verticalSpacing="sm" style={{ opacity: list.isPlaceholderData ? 0.6 : 1 }}>
            <Table.Thead>
              <Table.Tr>
                <SortHeader label="Name" field="fullName" sort={sort} onSort={onSort} />
                <SortHeader label="Job title" field="jobTitle" sort={sort} onSort={onSort} />
                <SortHeader label="Department" field="department" sort={sort} onSort={onSort} />
                <SortHeader label="Country" field="country" sort={sort} onSort={onSort} />
                <SortHeader label="Salary" field="salary" sort={sort} onSort={onSort} align="right" />
                <Table.Th style={{ textAlign: 'right' }} title="Salary sorting uses this USD equivalent">≈ USD</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.isPending &&
                Array.from({ length: 8 }, (_, i) => (
                  <Table.Tr key={i}>
                    {Array.from({ length: 6 }, (__, j) => (
                      <Table.Td key={j}>
                        <Skeleton h={14} />
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              {data?.data.map((e) => (
                <Table.Tr key={e.id} onClick={() => setSelectedId(e.id)} style={{ cursor: 'pointer' }}>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm" fw={500}>
                        {e.fullName}
                      </Text>
                      {e.status === 'terminated' && (
                        <Badge size="xs" variant="light" color="gray">
                          Left {e.terminatedAt}
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {e.employeeCode}
                    </Text>
                  </Table.Td>
                  <Table.Td>{e.jobTitle}</Table.Td>
                  <Table.Td>{e.department}</Table.Td>
                  <Table.Td>{countryName(e.country)}</Table.Td>
                  <Table.Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(e.salaryMinor, e.currency)}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    <Text size="sm" c="dimmed">
                      {formatUsd(e.salaryUsdMinor)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {data && data.total === 0 && (
          <Center p="xl">
            <Stack align="center" gap={4}>
              <Text fw={500}>No employees found</Text>
              <Text size="sm" c="dimmed">
                {hasFilters ? 'Try a different search or clear some filters.' : 'Add your first employee to get started.'}
              </Text>
            </Stack>
          </Center>
        )}
      </Paper>

      {data && data.totalPages > 1 && (
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Showing {formatCount((data.page - 1) * data.pageSize + 1)}–
            {formatCount(Math.min(data.page * data.pageSize, data.total))} of {formatCount(data.total)}
          </Text>
          <Pagination total={data.totalPages} value={page} onChange={setPage} siblings={1} />
        </Group>
      )}

      <EmployeeDrawer employeeId={selectedId} onClose={() => setSelectedId(null)} />

      <Modal opened={creating} onClose={() => setCreating(false)} title="Add employee" size="lg">
        <EmployeeForm
          submitLabel="Add employee"
          onSubmit={(input) => create.mutateAsync(input)}
          onCancel={() => setCreating(false)}
        />
      </Modal>
    </Stack>
  );
}
