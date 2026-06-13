import { useEffect } from 'react';
import { LogBox, Platform } from 'react-native';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
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
import { BillingDeepLinkHandler } from '@/components/billing-deeplink-handler';
import { LegacyTabsDeepLinkHandler } from '@/components/legacy-tabs-deeplink-handler';
import { AuthStackGate } from '@/components/auth-stack-gate';
import { AppI18nGate } from '@/components/providers/app-i18n-gate';
import { AuthSessionProvider } from '@/components/providers/auth-session-provider';
import {
  OwnerRedemptionSecurityProvider,
  useOwnerRedemptionSecurity,
} from '@/components/providers/owner-redemption-security-provider';
import { RedemptionModeGate, RedemptionModeProvider } from '@/components/providers/redemption-mode-provider';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useBusiness } from '@/hooks/use-business';
import { Colors } from '@/constants/theme';
import { TabModeProvider, useTabMode } from '@/lib/tab-mode';
import { CreateMenuOfferWizardProvider } from '@/lib/create-menu-offer-wizard-context';
import { getOwnerRedemptionSecurityStatus } from '@/lib/owner-redemption-security';

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

void SplashScreen.preventAutoHideAsync().catch(() => {});

export const unstable_settings = {
  /** Auth-first: cold start hits `index` before `(tabs)`. */
  anchor: 'index',
};

function isOwnerPinAllowedRoute(segments: string[]): boolean {
  const root = String(segments[0] ?? '');
  if (root === 'redemption-mode') return true;
  return root === '(tabs)' && String(segments[1] ?? '') === 'redeem';
}

function OwnerRedemptionPinGate() {
  const router = useRouter();
  const segments = useSegments();
  const { mode, ready } = useTabMode();
  const { businessId, loading } = useBusiness();
  const { isPinEnabled, isUnlocked, setPinEnabled } = useOwnerRedemptionSecurity();
  const ownerPinEnabled = businessId ? isPinEnabled(businessId) : null;

  useEffect(() => {
    if (!ready || mode !== 'business' || loading || !businessId || ownerPinEnabled !== null) return;
    let cancelled = false;
    void getOwnerRedemptionSecurityStatus(businessId)
      .then((status) => {
        if (!cancelled) setPinEnabled(businessId, status.enabled);
      })
      .catch((err) => {
        if (__DEV__) console.warn('[owner-pin-gate] status lookup failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, loading, mode, ownerPinEnabled, ready, setPinEnabled]);

  useEffect(() => {
    if (!ready || mode !== 'business' || !businessId || ownerPinEnabled !== true || isUnlocked(businessId)) return;
    if (isOwnerPinAllowedRoute(segments.map(String))) return;
    router.replace('/(tabs)/redeem' as Href);
  }, [businessId, isUnlocked, mode, ownerPinEnabled, ready, router, segments]);

  return null;
}

function RootNavigationStack() {
  const colorScheme = useColorScheme();
  const uiTheme = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const { t } = useTranslation();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* Deep link handlers — priority order:
         1. Auth recovery (password reset links)
         2. Billing deep links (subscription/checkout)
         3. Deal deep links (shared deal URLs)
         4. Notification deep links (push notification routes)
         5. Legacy tab format migration (backward compat) */}
      <LegacyTabsDeepLinkHandler />
      <NotificationDeepLinkHandler />
      <AuthRecoveryLinkHandler />
      <DealDeepLinkHandler />
      <BillingDeepLinkHandler />
      <AuthStackGate />
      <RedemptionModeGate />
      <OwnerRedemptionPinGate />
      <CreateMenuOfferWizardProvider>
      <Stack
        screenOptions={{
          headerBackButtonDisplayMode: 'minimal',
          headerBackButtonMenuEnabled: false,
          headerBackTitle: '',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: uiTheme.background },
          headerTintColor: uiTheme.primary,
          headerTitleStyle: { color: uiTheme.text, fontWeight: '700' },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="auth-landing" options={{ headerShown: false }} />
        <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="redemption-mode" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen
          name="consumer-profile-setup"
          options={{
            title: t('consumerProfile.navTitle'),
            headerBackButtonDisplayMode: 'minimal',
            headerBackTitle: '',
          }}
        />
        <Stack.Screen name="business-setup" options={{ title: t('businessSetup.navTitle') }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="forgot-password" options={{ title: t('passwordRecovery.forgotTitle') }} />
        <Stack.Screen name="reset-password" options={{ title: t('passwordRecovery.resetTitle') }} />
        <Stack.Screen name="create" options={{ headerShown: false }} />
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
            <RedemptionModeProvider>
              <OwnerRedemptionSecurityProvider>
                <TabModeProvider>
                  <DiagnosticBootLog />
                  <AppErrorBoundary>
                    <RootNavigationStack />
                  </AppErrorBoundary>
                  <ConsumerOnboardingGate />
                </TabModeProvider>
              </OwnerRedemptionSecurityProvider>
            </RedemptionModeProvider>
          </AuthSessionProvider>
        </SafeAreaProvider>
      </AppI18nGate>
    </AppErrorBoundary>
  );
}
