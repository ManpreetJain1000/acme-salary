'use client';

import { Button, Group, NumberInput, Select, SimpleGrid, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useEffect } from 'react';
import { notifications } from '@mantine/notifications';
import { ApiError } from '@/lib/api';
import { toMajor, toMinor } from '@/lib/format';
import { useMetaLookups } from '@/lib/hooks';
import type { Employee, EmployeeInput } from '@/lib/types';

interface FormValues {
  fullName: string;
  email: string;
  department: string;
  jobTitle: string;
  country: string;
  currency: string;
  salary: number | string; // major units in the form; converted to minor on submit
  hireDate: string;
}

interface Props {
  initial?: Employee;
  submitLabel: string;
  onSubmit: (input: EmployeeInput) => Promise<unknown>;
  onCancel: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export function EmployeeForm({ initial, submitLabel, onSubmit, onCancel }: Props) {
  const { meta, currencyFor, titlesFor } = useMetaLookups();

  const form = useForm<FormValues>({
    mode: 'controlled',
    initialValues: {
      fullName: initial?.fullName ?? '',
      email: initial?.email ?? '',
      department: initial?.department ?? '',
      jobTitle: initial?.jobTitle ?? '',
      country: initial?.country ?? '',
      currency: initial?.currency ?? '',
      salary: initial ? toMajor(initial.salaryMinor) : '',
      hireDate: initial?.hireDate ?? today(),
    },
    // Client-side checks mirror the API's for fast feedback; the API remains the authority.
    validate: {
      fullName: (v) => (v.trim().length >= 2 ? null : 'Enter the full name'),
      email: (v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? null : 'Enter a valid email'),
      department: (v) => (v ? null : 'Choose a department'),
      jobTitle: (v) => (v ? null : 'Choose a job title'),
      country: (v) => (v ? null : 'Choose a country'),
      currency: (v) => (v ? null : 'Choose a currency'),
      salary: (v) => (toMinor(v) ? null : 'Enter an annual salary greater than 0'),
      hireDate: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'Enter a hire date'),
    },
  });

  // Default the currency to the country's local currency (still overridable).
  const country = form.values.country;
  useEffect(() => {
    if (!country || form.isTouched('currency')) return;
    const currency = currencyFor(country);
    if (currency) form.setFieldValue('currency', currency);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  const submit = form.onSubmit(async (v) => {
    try {
      await onSubmit({
        fullName: v.fullName.trim(),
        email: v.email.trim(),
        department: v.department,
        jobTitle: v.jobTitle,
        country: v.country,
        currency: v.currency,
        salaryMinor: toMinor(v.salary)!,
        hireDate: v.hireDate,
      });
    } catch (err) {
      // Map server-side validation/conflict errors back onto the fields; anything
      // else (network, 5xx) gets a toast. Handled here, so nothing is rethrown.
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        form.setFieldError('email', err.message);
      } else if (err instanceof ApiError && err.details.length > 0) {
        for (const d of err.details) {
          form.setFieldError(d.path === 'salaryMinor' ? 'salary' : d.path, d.message);
        }
      } else {
        notifications.show({ color: 'red', title: 'Could not save', message: (err as Error).message });
      }
    }
  });

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="sm">
        <TextInput label="Full name" required {...form.getInputProps('fullName')} />
        <TextInput label="Work email" type="email" required {...form.getInputProps('email')} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Department"
            required
            data={meta?.departments.map((d) => d.name) ?? []}
            {...form.getInputProps('department')}
            onChange={(v) => {
              form.setFieldValue('department', v ?? '');
              if (!titlesFor(v).includes(form.values.jobTitle)) form.setFieldValue('jobTitle', '');
            }}
          />
          <Select
            label="Job title"
            required
            searchable
            disabled={!form.values.department}
            data={titlesFor(form.values.department)}
            {...form.getInputProps('jobTitle')}
          />
          <Select
            label="Country"
            required
            searchable
            data={meta?.countries.map((c) => ({ value: c.code, label: c.name })) ?? []}
            {...form.getInputProps('country')}
          />
          <Select
            label="Currency"
            required
            data={meta?.currencies.map((c) => c.code) ?? []}
            {...form.getInputProps('currency')}
          />
          <NumberInput
            label="Annual salary"
            description="In the selected currency"
            required
            min={0}
            decimalScale={2}
            thousandSeparator=","
            {...form.getInputProps('salary')}
          />
          <TextInput label="Hire date" type="date" required {...form.getInputProps('hireDate')} />
        </SimpleGrid>
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={form.submitting}>
            {submitLabel}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
