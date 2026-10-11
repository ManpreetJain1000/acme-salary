'use client';

import { Alert, Button, Center, Code, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconInfoCircle, IconLock } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api, ApiError, safeNext } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // Only answers on demo deployments; elsewhere it's a 404 and nothing is shown.
  const demo = useQuery({ queryKey: ['demo-credentials'], queryFn: api.demoCredentials, retry: false });

  const form = useForm({
    initialValues: { email: '', password: '' },
    validate: {
      email: (v) => (/^\S+@\S+$/.test(v.trim()) ? null : 'Enter your work email'),
      password: (v) => (v ? null : 'Enter your password'),
    },
  });

  const submit = form.onSubmit(async ({ email, password }) => {
    setError(null);
    try {
      await api.login(email.trim(), password);
      queryClient.clear(); // nothing cached from before sign-in
      router.replace(safeNext(params.get('next')));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
    }
  });

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder radius="md" p="xl" w="100%" maw={400}>
        <form onSubmit={submit} noValidate>
          <Stack gap="md">
            <div>
              <Title order={2}>ACME Salary Manager</Title>
              <Text c="dimmed" size="sm">
                Sign in to manage salaries.
              </Text>
            </div>
            {error && (
              <Alert color="red" icon={<IconLock size={18} />} role="alert">
                {error}
              </Alert>
            )}
            <TextInput label="Work email" type="email" autoComplete="username" required {...form.getInputProps('email')} />
            <PasswordInput label="Password" autoComplete="current-password" required {...form.getInputProps('password')} />
            <Button type="submit" loading={form.submitting} fullWidth>
              Sign in
            </Button>
            {demo.data && (
              <Alert variant="light" icon={<IconInfoCircle size={18} />} title="Demo sign-in">
                <Text size="sm">
                  Email <Code>{demo.data.email}</Code>
                  <br />
                  Password <Code>{demo.data.password}</Code>
                </Text>
                <Button
                  variant="subtle"
                  size="compact-sm"
                  mt={6}
                  onClick={() => form.setValues({ email: demo.data.email, password: demo.data.password })}
                >
                  Fill in
                </Button>
              </Alert>
            )}
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
