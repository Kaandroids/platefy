import { Nunito_500Medium } from '@expo-google-fonts/nunito/500Medium';
import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';
import { Nunito_800ExtraBold } from '@expo-google-fonts/nunito/800ExtraBold';
import { Nunito_900Black } from '@expo-google-fonts/nunito/900Black';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { SessionEnded } from '@/components/session-ended';
import { SessionError } from '@/components/session-error';
import '@/i18n';
import { OnboardingProvider, useOnboarding } from '@/providers/onboarding-provider';
import { QueryProvider } from '@/providers/query-provider';
import { SessionProvider, useSession } from '@/providers/session-provider';
import { showRemindersInForeground } from '@/reminders/reminders';
import { LeftOpenSaver } from '@/sessions/left-open';
import { StartMoveSheet } from '@/sessions/start-move';
import { REST_NOTIFICATION_ID, RestAlarm } from '@/sessions/rest-alarm';
import { endSession } from '@/sessions/session';
import { fonts, useTheme } from '@/theme';

// Keeps the native splash screen visible until the fonts and the session are ready.
void SplashScreen.preventAutoHideAsync();
showRemindersInForeground([REST_NOTIFICATION_ID]);

export default function RootLayout() {
  return (
    // Gesture detectors, such as the one in the slider, only work inside this view.
    <GestureHandlerRootView style={styles.root}>
      <SessionProvider>
        <QueryProvider>
          <OnboardingProvider>
            <RootNavigator />
          </OnboardingProvider>
        </QueryProvider>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { status, retry, startAgain } = useSession();
  const { completed } = useOnboarding();
  const { colors } = useTheme();
  // Keys must match the family names in `fonts`. If loading fails, text falls back to the system font.
  const [fontsLoaded, fontError] = useFonts({
    [fonts.medium]: Nunito_500Medium,
    [fonts.bold]: Nunito_700Bold,
    [fonts.extraBold]: Nunito_800ExtraBold,
    [fonts.black]: Nunito_900Black,
  });
  const isReady = (fontsLoaded || fontError !== null) && status !== 'loading';

  // The root view shows through during screen transitions and keyboard animations.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);

  useEffect(() => {
    if (isReady) {
      SplashScreen.hide();
    }
  }, [isReady]);

  if (!isReady) {
    return null;
  }

  return (
    <>
      <StatusBar style="auto" />
      {status === 'ready' ? <RestAlarm /> : null}
      {status === 'error' ? (
        <SessionError onRetry={retry} />
      ) : status === 'ended' ? (
        <SessionEnded
          onStartAgain={() => {
            // The workout in progress was the previous guest's.
            endSession();
            return startAgain();
          }}
        />
      ) : (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          {/* Until the onboarding is finished, only the onboarding is reachable. Finishing it
              switches to the app and removes the onboarding from the history. */}
          <Stack.Protected guard={!completed}>
            <Stack.Screen name="onboarding" />
          </Stack.Protected>
          <Stack.Protected guard={completed}>
            <Stack.Screen name="(app)" />
            {/* The workout in progress covers the tabs, so nothing but the workout is in reach. */}
            <Stack.Screen name="session/index" />
            <Stack.Screen name="session/finish" />
          </Stack.Protected>
          <Stack.Screen name="dev/components" />
        </Stack>
      )}
      {/* Over every screen, as the app may open on any of them. */}
      {status === 'ready' ? <LeftOpenSaver /> : null}
      {status === 'ready' ? <StartMoveSheet /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
