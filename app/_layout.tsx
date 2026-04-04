import { useEffect } from 'react';
import { LogBox, Platform } from 'react-native';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import 'react-native-reanimated';

// N-2 FIX: Register foreground notification handler at module level so
// notifications received while the app is open are displayed to the user.
// This MUST run before any component mounts.
if (Platform.OS !== 'web') {
  void import('expo-notifications').then((Notifications) => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    // N-1 FIX: Create the Android notification channel. Without this,
    // all push notifications on Android 8+ are silently dropped.
    if (Platform.OS === 'android') {
      void Notifications.setNotificationChannelAsync('deal-alerts', {
        name: 'Deal Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF9F1C',
      });
    }
  }).catch(() => {});
}

// FIX: Suppress known non-actionable dev warnings that clutter demo presentations.
// These are React/RN framework warnings, not app bugs.
if (__DEV__) {
  LogBox.ignoreLogs([
    'Non-serializable values were found in the navigation state',
    'Each child in a list should have a unique "key" prop',
    '[billing-pricing]',
  ]);
}

import { AppErrorBoundary } from '@/components/app-error-boundary';
import { ConsumerOnboardingGate } from '@/components/consumer-onboarding-gate';
import { AuthRecoveryLinkHandler } from '@/components/auth-recovery-link-handler';
import { DiagnosticBootLog } from '@/components/diagnostic-boot-log';
import { NotificationDeepLinkHandler } from '@/components/notification-deeplink-handler';
import { DealDeepLinkHandler } from '@/components/deal-deeplink-handler';
import { BillingDeepLinkHandler } from '@/components/billing-deeplink-handler';
import { LegacyTabsDeepLinkHandler } from '@/components/legacy-tabs-deeplink-handler';
import { AuthStackGate } from '@/components/auth-stack-gate';
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
      <BillingDeepLinkHandler />
      <AuthStackGate />
      <CreateMenuOfferWizardProvider>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="auth-landing" options={{ headerShown: false }} />
        <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="consumer-profile-setup" options={{ title: t('consumerProfile.navTitle') }} />
        <Stack.Screen name="business-setup" options={{ title: t('businessSetup.navTitle') }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="forgot-password" options={{ title: t('passwordRecovery.forgotTitle') }} />
        <Stack.Screen name="reset-password" options={{ title: t('passwordRecovery.resetTitle') }} />
        <Stack.Screen name="create/quick" options={{ headerShown: false }} />
        <Stack.Screen name="create/ai" options={{ title: t('createAi.titleScreen') }} />
        <Stack.Screen name="create/ai-compose" options={{ title: t('aiCompose.title') }} />
        <Stack.Screen name="create/reuse" options={{ title: t('reuseHub.title') }} />
        <Stack.Screen name="create/menu-scan" options={{ title: t('menuScan.title') }} />
        <Stack.Screen name="create/menu-manager" options={{ title: t('menuManager.title') }} />
        <Stack.Screen name="create/menu-offer" options={{ title: t('menuOffer.title') }} />
        <Stack.Screen name="create/ad-refine" options={{ title: t('adRefine.title') }} />
        <Stack.Screen name="deal/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="business/[id]" options={{ title: t('businessProfile.title') }} />

        <Stack.Screen name="deal-analytics/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="debug-diagnostics" options={{ title: t('debugDiagnostics.title') }} />
      </Stack>
      </CreateMenuOfferWizardProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  // FIX: Reduced splash fallback from 8s to 3s. The normal path hides splash
  // via AppI18nGate once i18n loads (~200ms). This timeout is a safety net for
  // edge cases. 8s felt like a frozen app; 3s is sufficient without being jarring.
  useEffect(() => {
    const id = setTimeout(() => {
      void SplashScreen.hideAsync();
    }, 3000);
    return () => clearTimeout(id);
  }, []);

  return (
    <AppErrorBoundary>
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
    </AppErrorBoundary>
  );
}
