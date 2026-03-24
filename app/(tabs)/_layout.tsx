import { Tabs, useRouter, useSegments } from 'expo-router';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { TabModeProvider, useTabMode } from '@/lib/tab-mode';

export default function TabLayout() {
  return (
    <TabModeProvider>
      <TabLayoutInner />
    </TabModeProvider>
  );
}

function TabModeRedirect() {
  const { mode, ready } = useTabMode();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const segs = segments as string[];
    const tabsIdx = segs.indexOf("(tabs)");
    if (tabsIdx === -1) return;
    const tab = String(segs[tabsIdx + 1] ?? "index");

    if (mode === "business") {
      if (tab === "index" || tab === "favorites" || tab === "wallet") {
        router.replace("/(tabs)/create");
      }
    } else {
      if (tab === "create" || tab === "redeem" || tab === "dashboard") {
        router.replace("/(tabs)");
      }
    }
  }, [ready, mode, segments, router]);

  return null;
}

function TabLayoutInner() {
  const colorScheme = useColorScheme();
  const { t } = useTranslation();
  const { mode } = useTabMode();

  const hideWhen = (condition: boolean): { href: null } | Record<string, never> =>
    condition ? { href: null } : {};

  return (
    <>
      <TabModeRedirect />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
          tabBarItemStyle: { paddingVertical: 2 },
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: t('tabs.deals'),
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
            ...hideWhen(mode === 'business'),
          }}
        />
        <Tabs.Screen
          name="favorites"
          options={{
            title: t('tabs.favorites'),
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="heart.fill" color={color} />,
            ...hideWhen(mode === 'business'),
          }}
        />
        <Tabs.Screen
          name="wallet"
          options={{
            title: t('tabs.wallet'),
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="wallet.pass.fill" color={color} />,
            ...hideWhen(mode === 'business'),
          }}
        />
        <Tabs.Screen
          name="create"
          options={{
            title: t('tabs.create'),
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="plus.circle.fill" color={color} />,
            ...hideWhen(mode === 'customer'),
          }}
        />
        <Tabs.Screen
          name="redeem"
          options={{
            title: t('tabs.redeem'),
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="qrcode.viewfinder" color={color} />,
            ...hideWhen(mode === 'customer'),
          }}
        />
        <Tabs.Screen
          name="dashboard"
          options={{
            title: t('tabs.dashboard'),
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="chart.bar.fill" color={color} />,
            ...hideWhen(mode === 'customer'),
          }}
        />
        <Tabs.Screen
          name="account"
          options={{
            title: t('tabs.account'),
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="person.crop.circle.fill" color={color} />,
          }}
        />
        <Tabs.Screen name="settings" options={{ href: null }} />
        <Tabs.Screen name="explore" options={{ href: null }} />
        <Tabs.Screen name="auth" options={{ href: null }} />
      </Tabs>
    </>
  );
}
