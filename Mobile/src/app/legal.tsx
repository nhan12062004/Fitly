import { Linking, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui/screen';
import { legalContent } from '../../../shared/legalContent';
import { settingsStyles as styles } from '@/theme/settings-styles';

export default function LegalScreen() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const content = legalContent[section === 'terms' ? 'terms' : 'privacy'];
  return <Screen>
    <Pressable accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace('/sign-in')} style={styles.linkButton}><Text style={styles.link}>← Quay lại</Text></Pressable>
    <Text style={styles.title}>{content.title}</Text>
    {content.sections.map((item) => <View key={item.title} style={styles.card}><Text style={styles.subtitle}>{item.title}</Text><Text style={styles.body}>{item.text}</Text></View>)}
    <Pressable accessibilityRole="link" style={styles.linkButton} onPress={() => void Linking.openURL(`https://trend-fit.vercel.app/${section === 'terms' ? 'terms' : 'privacy'}`).catch(() => undefined)}><Text style={styles.link}>Xem chính sách trên website Fitly</Text></Pressable>
  </Screen>;
}
