import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/providers/auth-provider';

const BACKGROUND = '#111111';
const GREEN = '#22C55E';
const USE_NATIVE_DRIVER = Platform.OS !== 'web';

export function StartupSplash({ onFinish }: { onFinish: () => void }) {
  const { isLoading, recoveryStatus } = useAuth();
  const insets = useSafeAreaInsets();
  const [fontLoaded, fontError] = useFonts({
    'Manrope-ExtraBold': require('../../../assets/fonts/Manrope-ExtraBold.ttf'),
  });
  const [laidOut, setLaidOut] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [introFinished, setIntroFinished] = useState(false);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [entrance] = useState(() => new Animated.Value(0));
  const [loading] = useState(() => new Animated.Value(0));
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (active) setReduceMotion(enabled); })
      .catch(() => { if (active) setReduceMotion(true); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (!laidOut || !imageReady || (!fontLoaded && !fontError) || reduceMotion === null) return;
    let active = true;
    // Hand off only after the matching React screen has laid out and its logo is decoded.
    void SplashScreen.hideAsync().catch(() => undefined).then(() => {
      if (active) setStarted(true);
    });
    return () => { active = false; };
  }, [laidOut, imageReady, fontLoaded, fontError, reduceMotion]);

  useEffect(() => {
    if (!started) return;
    if (reduceMotion) {
      entrance.setValue(1);
      return;
    }
    const animation = Animated.timing(entrance, {
      toValue: 1, duration: 460, easing: Easing.out(Easing.cubic), useNativeDriver: USE_NATIVE_DRIVER,
    });
    animation.start();
    const timer = setTimeout(() => setIntroFinished(true), 900);
    return () => { clearTimeout(timer); animation.stop(); };
  }, [started, reduceMotion, entrance]);

  useEffect(() => {
    if (!started || reduceMotion) return;
    const animation = Animated.loop(Animated.timing(loading, {
      toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad),
      useNativeDriver: USE_NATIVE_DRIVER, isInteraction: false,
    }));
    animation.start();
    return () => animation.stop();
  }, [started, reduceMotion, loading]);

  useEffect(() => {
    if (!started || (!introFinished && !reduceMotion) || isLoading || recoveryStatus === 'processing') return;
    const animation = Animated.timing(opacity, {
      toValue: 0, duration: reduceMotion ? 0 : 260, useNativeDriver: USE_NATIVE_DRIVER,
    });
    animation.start(({ finished }) => { if (finished) onFinish(); });
    return () => animation.stop();
  }, [started, introFinished, isLoading, recoveryStatus, reduceMotion, opacity, onFinish]);

  return (
    <Animated.View
      testID="startup-splash"
      accessibilityViewIsModal
      accessibilityLabel="Fitly đang khởi động"
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      onLayout={() => setLaidOut(true)}
      style={[styles.container, { opacity }]}
    >
      <View style={styles.brand}>
        <Animated.View style={{ transform: [{ scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }] }}>
          <Image
            source={require('../../../assets/images/fitly-splash.png')}
            style={styles.mark}
            accessible={false}
            fadeDuration={0}
            onLoad={() => setImageReady(true)}
            onError={() => setImageReady(true)}
          />
        </Animated.View>
        <Animated.View style={[styles.wordmark, {
          opacity: entrance,
          transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        }]}>
          <Text style={[styles.name, fontLoaded && styles.brandFont]}>Fitly<Text style={styles.dot}>.</Text></Text>
          <Text style={styles.tagline}>Khỏe hơn mỗi ngày</Text>
        </Animated.View>
      </View>
      <View style={[styles.footer, { bottom: insets.bottom + 48 }]}>
        <View style={styles.track}>
          <Animated.View style={[styles.indicator, {
            transform: [{ translateX: reduceMotion ? 42 : loading.interpolate({ inputRange: [0, 1], outputRange: [-36, 120] }) }],
          }]} />
        </View>
        <Text style={styles.loadingText}>Đang mở Fitly…</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: BACKGROUND },
  brand: { alignItems: 'center', justifyContent: 'center', width: '100%', height: 112 },
  mark: { width: 112, height: 112 },
  wordmark: { position: 'absolute', top: 140, alignItems: 'center' },
  name: { color: '#F8F8F6', fontSize: 42, lineHeight: 56, fontWeight: '800', letterSpacing: -2 },
  brandFont: { fontFamily: 'Manrope-ExtraBold' },
  dot: { color: GREEN },
  tagline: { marginTop: 6, color: '#A5AAA6', fontSize: 14, letterSpacing: 0.2 },
  footer: { position: 'absolute', alignItems: 'center', gap: 16 },
  track: { width: 120, height: 3, borderRadius: 2, overflow: 'hidden', backgroundColor: '#262626' },
  indicator: { width: 36, height: 3, borderRadius: 2, backgroundColor: GREEN },
  loadingText: { color: '#A5AAA6', fontSize: 12, letterSpacing: 0.3 },
});
