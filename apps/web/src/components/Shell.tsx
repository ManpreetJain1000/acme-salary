'use client';

import { AppShell, Burger, Group, NavLink, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconChartBar, IconUsers } from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const NAV = [
  { href: '/', label: 'Employees', icon: IconUsers },
  { href: '/insights', label: 'Pay insights', icon: IconChartBar },
];

export function Shell({ children }: { children: ReactNode }) {
  const [opened, { toggle, close }] = useDisclosure();
  const pathname = usePathname();

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
