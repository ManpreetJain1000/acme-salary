'use client';

import {
  Alert,
  Badge,
  Button,
  Divider,
  Drawer,
  Group,
  Modal,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Timeline,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconArrowBackUp, IconDoorExit, IconPencil } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, isStale } from '@/lib/api';
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
  const { meta, countryName } = useMetaLookups();
  const [editing, setEditing] = useState(false);
  const [leaveDate, setLeaveDate] = useState<string | null>(null); // non-null = dialog open

  const query = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => api.getEmployee(employeeId!),
    enabled: employeeId !== null,
  });
  const employee = query.data;

  const invalidate = () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'meta' });

  // Someone else saved first: reload their version so this user sees it before retrying.
  const reloadIfStale = (err: Error) => {
    if (isStale(err)) void queryClient.invalidateQueries({ queryKey: ['employee', employeeId] });
  };

  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.updateEmployee>[2]) =>
      api.updateEmployee(employeeId!, employee!.version, input),
    onError: (err) => {
      if (isStale(err)) setEditing(false); // close the form on the outdated copy
      reloadIfStale(err);
    },
    onSuccess: async () => {
      await invalidate();
      setEditing(false);
      notifications.show({ color: 'green', message: 'Employee updated' });
    },
  });

  const showError = (err: Error) => {
    notifications.show({ color: 'red', message: err.message });
    reloadIfStale(err);
  };

  // Leaving keeps the record and its salary history; it can be undone with Reinstate.
  const terminate = useMutation({
    mutationFn: (date: string) => api.terminateEmployee(employeeId!, employee!.version, date),
    onSuccess: async (e) => {
      setLeaveDate(null);
      await invalidate();
      notifications.show({ color: 'green', message: `${e.fullName} marked as left on ${e.terminatedAt}` });
    },
    onError: showError,
  });

  const reinstate = useMutation({
    mutationFn: () => api.reinstateEmployee(employeeId!, employee!.version),
    onSuccess: async (e) => {
      await invalidate();
      notifications.show({ color: 'green', message: `${e.fullName} reinstated` });
    },
    onError: showError,
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
                ≈ {formatUsd(employee.salaryUsdMinor)} at static rates as of {meta?.fxAsOf ?? '…'}
              </Text>
            )}
            <Text size="sm" c="dimmed">
              Hired {employee.hireDate}
              {employee.terminatedAt && ` · Left ${employee.terminatedAt}`}
            </Text>
          </div>
          {employee.status === 'terminated' && (
            <Alert color="gray" icon={<IconDoorExit />} title="Former employee">
              Kept with their salary history, but left out of pay insights. Reinstate them to make changes.
            </Alert>
          )}
          <Group>
            {employee.status === 'active' ? (
              <>
                <Button leftSection={<IconPencil size={16} />} onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button
                  variant="light"
                  color="red"
                  leftSection={<IconDoorExit size={16} />}
                  onClick={() => setLeaveDate(new Date().toISOString().slice(0, 10))}
                >
                  Mark as left
                </Button>
              </>
            ) : (
              <Button
                variant="light"
                leftSection={<IconArrowBackUp size={16} />}
                loading={reinstate.isPending}
                onClick={() => reinstate.mutate()}
              >
                Reinstate
              </Button>
            )}
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
      <Modal opened={leaveDate !== null} onClose={() => setLeaveDate(null)} title="Mark as left?" size="sm">
        <Stack gap="sm">
          <Text size="sm">
            <b>{employee?.fullName}</b> will move to former employees. Their record and salary history are kept,
            and you can reinstate them later.
          </Text>
          <TextInput
            label="Last day of employment"
            type="date"
            value={leaveDate ?? ''}
            min={employee?.hireDate}
            onChange={(e) => setLeaveDate(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setLeaveDate(null)}>
              Cancel
            </Button>
            <Button color="red" loading={terminate.isPending} disabled={!leaveDate} onClick={() => terminate.mutate(leaveDate!)}>
              Mark as left
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Drawer>
  );
}
