'use client';

import {
  Alert,
  Badge,
  Button,
  Divider,
  Drawer,
  Group,
  Skeleton,
  Stack,
  Text,
  Timeline,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconPencil, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { formatMoney, formatPercent, formatUsd } from '@/lib/format';
import { useMetaLookups } from '@/lib/hooks';
import type { SalaryChange } from '@/lib/types';
import { EmployeeForm } from './EmployeeForm';

interface Props {
  employeeId: number | null;
  onClose: () => void;
}

function describeChange(c: SalaryChange): { label: string; delta?: string } {
  if (c.oldSalaryMinor === null) return { label: 'Starting salary' };
  if (c.oldCurrency !== c.newCurrency) return { label: `Currency changed from ${c.oldCurrency}` };
  const delta = (c.newSalaryMinor - c.oldSalaryMinor) / c.oldSalaryMinor;
  return { label: delta >= 0 ? 'Raise' : 'Reduction', delta: formatPercent(delta, { signed: true }) };
}

export function EmployeeDrawer({ employeeId, onClose }: Props) {
  const queryClient = useQueryClient();
  const { countryName } = useMetaLookups();
  const [editing, setEditing] = useState(false);

  const query = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => api.getEmployee(employeeId!),
    enabled: employeeId !== null,
  });
  const employee = query.data;

  const invalidate = () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'meta' });

  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.updateEmployee>[1]) => api.updateEmployee(employeeId!, input),
    onSuccess: async () => {
      await invalidate();
      setEditing(false);
      notifications.show({ color: 'green', message: 'Employee updated' });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteEmployee(employeeId!),
    onSuccess: async () => {
      onClose();
      await invalidate();
      notifications.show({ color: 'green', message: 'Employee deleted' });
    },
    onError: (err) => notifications.show({ color: 'red', message: err.message }),
  });

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: 'Delete employee?',
      children: (
        <Text size="sm">
          This permanently removes <b>{employee?.fullName}</b> and their salary history.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(),
    });

  const close = () => {
    setEditing(false);
    onClose();
  };

  return (
    <Drawer
      opened={employeeId !== null}
      onClose={close}
      position="right"
      size="lg"
      title={editing ? 'Edit employee' : 'Employee'}
    >
      {query.isPending && employeeId !== null && (
        <Stack>
          <Skeleton h={28} w="60%" />
          <Skeleton h={16} w="40%" />
          <Skeleton h={120} />
        </Stack>
      )}
      {query.isError && (
        <Alert color="red" icon={<IconAlertCircle />} title="Couldn't load employee">
          {query.error.message}
        </Alert>
      )}

      {employee && editing && (
        <EmployeeForm
          initial={employee}
          submitLabel="Save changes"
          onSubmit={(input) => update.mutateAsync(input)}
          onCancel={() => setEditing(false)}
        />
      )}

      {employee && !editing && (
        <Stack gap="md">
          <div>
            <Title order={3}>{employee.fullName}</Title>
            <Text c="dimmed" size="sm">
              {employee.employeeCode} · {employee.email}
            </Text>
          </div>
          <Group gap="xs">
            <Badge variant="light">{employee.department}</Badge>
            <Badge variant="light" color="grape">{employee.jobTitle}</Badge>
            <Badge variant="light" color="teal">{countryName(employee.country)}</Badge>
          </Group>
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Annual salary
            </Text>
            <Text size="xl" fw={700}>
              {formatMoney(employee.salaryMinor, employee.currency)}
            </Text>
            {employee.currency !== 'USD' && (
              <Text size="sm" c="dimmed">
                ≈ {formatUsd(employee.salaryUsdMinor)}
              </Text>
            )}
            <Text size="sm" c="dimmed">
              Hired {employee.hireDate}
            </Text>
          </div>
          <Group>
            <Button leftSection={<IconPencil size={16} />} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              variant="light"
              color="red"
              leftSection={<IconTrash size={16} />}
              loading={remove.isPending}
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </Group>

          <Divider label="Salary history" labelPosition="left" />
          <Timeline active={employee.salaryHistory.length} bulletSize={14} lineWidth={2}>
            {employee.salaryHistory.map((c, i) => {
              const { label, delta } = describeChange(c);
              return (
                <Timeline.Item
                  key={`${c.changedAt}-${i}`}
                  title={
                    <Group gap="xs">
                      <Text fw={600} size="sm">
                        {formatMoney(c.newSalaryMinor, c.newCurrency)}
                      </Text>
                      {delta && (
                        <Badge size="sm" variant="light" color={delta.startsWith('-') ? 'red' : 'green'}>
                          {delta}
                        </Badge>
                      )}
                    </Group>
                  }
                >
                  <Text size="xs" c="dimmed">
                    {label} · {c.changedAt.slice(0, 10)}
                  </Text>
                </Timeline.Item>
              );
            })}
          </Timeline>
        </Stack>
      )}
    </Drawer>
  );
}
