import { Text } from 'react-native';

import { FoundationCard } from '@/components/ui/foundation-card';
import { Screen } from '@/components/ui/screen';
import { tokens } from '@/theme/tokens';

export default function CoachScreen() {
  return (
    <Screen>
      <Text style={{ color: tokens.colors.ink, fontSize: tokens.type.title, fontWeight: '900' }}>AI Coach</Text>
      <FoundationCard eyebrow="Protected flow" title="Proposal first" description="Chat, quota và apply/reject sẽ luôn đi qua Express. Apply dùng Idempotency-Key; chưa có AI action nào trong foundation." />
    </Screen>
  );
}
