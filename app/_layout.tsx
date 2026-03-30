import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import 'react-native-reanimated';

import { AppErrorBoundary } from '@/components/app-error-boundary';
import { ConsumerOnboardingGate } from '@/components/consumer-onboarding-gate';
import { AuthRecoveryLinkHandler } from '@/components/auth-recovery-link-handler';
import { DiagnosticBootLog } from '@/components/diagnostic-boot-log';
import { NotificationDeepLinkHandler } from '@/components/notification-deeplink-handler';
import { DealDeepLinkHandler } from '@/components/deal-deeplink-handler';
import { LegacyTabsDeepLinkHandler } from '@/components/legacy-tabs-deeplink-handler';
import { AppI18nGate } from '@/components/providers/app-i18n-gate';
import { AuthSessionProvider } from '@/components/providers/auth-session-provider';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { TabModeProvider } from '@/lib/tab-mode';
import { CreateMenuOfferWizardProvider } from '@/lib/create-menu-offer-wizard-context';

void SplashScreen.preventAutoHideAsync().catch(() => {});

export const unstable_settings = {
  /** Auth-first: cold start hits `index` before `(tabs)`. */
  anchor: 'index',
};

function RootNavigationStack() {
  const colorScheme = useColorScheme();
  const { t } = useTranslation();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <LegacyTabsDeepLinkHandler />
      <NotificationDeepLinkHandler />
      <AuthRecoveryLinkHandler />
      <DealDeepLinkHandler />
      <CreateMenuOfferWizardProvider>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="auth-landing" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="consumer-profile-setup" options={{ title: t('consumerProfile.navTitle') }} />
        <Stack.Screen name="business-setup" options={{ title: t('businessSetup.navTitle') }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="forgot-password" options={{ title: t('passwordRecovery.forgotTitle') }} />
        <Stack.Screen name="reset-password" options={{ title: t('passwordRecovery.resetTitle') }} />
        <Stack.Screen name="create/quick" options={{ title: t('createQuick.title') }} />
        <Stack.Screen name="create/ai" options={{ title: t('createAi.titleScreen') }} />
        <Stack.Screen name="create/ai-compose" options={{ title: t('aiCompose.title') }} />
        <Stack.Screen name="create/reuse" options={{ title: t('reuseHub.title') }} />
        <Stack.Screen name="create/menu-scan" options={{ title: t('menuScan.title') }} />
        <Stack.Screen name="create/menu-offer" options={{ title: t('menuOffer.title') }} />
        <Stack.Screen name="create/ad-refine" options={{ title: t('adRefine.title') }} />
        <Stack.Screen name="deal/[id]" options={{ title: t('dealDetail.title') }} />
        <Stack.Screen name="business/[id]" options={{ title: t('businessProfile.title') }} />
        <Stack.Screen
          name="modal"
          options={{ presentation: 'modal', title: t('commonUi.modalTitle') }}
        />
        <Stack.Screen name="deal-analytics/[id]" options={{ title: t('dealAnalytics.title') }} />
        <Stack.Screen name="debug-diagnostics" options={{ title: t('debugDiagnostics.title') }} />
      </Stack>
      </CreateMenuOfferWizardProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  useEffect(() => {
    const id = setTimeout(() => {
      void SplashScreen.hideAsync();
    }, 8000);
    return () => clearTimeout(id);
  }, []);

  return (
    <AppI18nGate>
      <SafeAreaProvider>
        <AuthSessionProvider>
          <TabModeProvider>
            <DiagnosticBootLog />
            <AppErrorBoundary>
              <RootNavigationStack />
            </AppErrorBoundary>
            <ConsumerOnboardingGate />
          </TabModeProvider>
        </AuthSessionProvider>
      </SafeAreaProvider>
    </AppI18nGate>
  );
}
