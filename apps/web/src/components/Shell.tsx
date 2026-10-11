'use client';

import { Alert, AppShell, Burger, Button, Center, Group, Loader, NavLink, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconChartBar, IconLogout, IconUsers } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';

const NAV = [
  { href: '/', label: 'Employees', icon: IconUsers },
  { href: '/insights', label: 'Pay insights', icon: IconChartBar },
];

export function Shell({ children }: { children: ReactNode }) {
  const [opened, { toggle, close }] = useDisclosure();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const onLogin = pathname === '/login';

  // Who is signed in. Until this answers, render no page, so protected screens
  // never flash (or fire requests) for a signed-out visitor; a 401 redirects to /login.
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, enabled: !onLogin, retry: false, staleTime: 60_000 });

  const signedOut = me.error instanceof ApiError && me.error.status === 401;
  useEffect(() => {
    // Not from /login itself, or the return address would become "/login".
    if (signedOut && !onLogin) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [signedOut, onLogin, pathname, router]);

  const signOut = async () => {
    await api.logout();
    queryClient.clear(); // drop every cached salary
    router.replace('/login');
  };

  if (onLogin) return <>{children}</>;
  if (me.isError && !signedOut) {
    return (
      <Center mih="100vh" p="md">
        <Alert color="red" title="Can't reach the server" maw={420}>
          {me.error.message}{' '}
          <Button variant="subtle" size="compact-sm" onClick={() => me.refetch()}>
            Retry
          </Button>
        </Alert>
      </Center>
    );
  }
  if (!me.data) {
    return (
      <Center mih="100vh">
        <Loader aria-label="Checking sign-in" />
      </Center>
    );
  }

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
          <Title order={4}>ACME Salary Manager</Title>
          <Text size="sm" c="dimmed" visibleFrom="sm">
            HR
          </Text>
          <Group gap="xs" ml="auto">
            <Text size="sm" c="dimmed" visibleFrom="sm">
              {me.data.email}
            </Text>
            <Button variant="subtle" size="compact-sm" leftSection={<IconLogout size={16} />} onClick={signOut}>
              Sign out
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {NAV.map(({ href, label, icon: Icon }) => (
          <NavLink
            key={href}
            component={Link}
            href={href}
            label={label}
            leftSection={<Icon size={18} stroke={1.6} />}
            active={href === '/' ? pathname === '/' : pathname.startsWith(href)}
            onClick={close}
          />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
