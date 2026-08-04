import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type IconName =
  | 'home'
  | 'workout'
  | 'coach'
  | 'meals'
  | 'profile'
  | 'calendar'
  | 'flame'
  | 'check'
  | 'target'
  | 'play'
  | 'arrow-right'
  | 'refresh'
  | 'bot'
  | 'paperclip'
  | 'camera'
  | 'image'
  | 'mic'
  | 'send'
  | 'zap';

type AppIconProps = {
  name: IconName;
  size?: number;
  color?: ColorValue;
  strokeWidth?: number;
} & Pick<ComponentProps<typeof Svg>, 'accessibilityLabel'>;

/** Lightweight SVG icon set used across Fitly mobile. */
export function AppIcon({ name, size = 24, color = '#EEF8F0', strokeWidth = 1.9, accessibilityLabel }: AppIconProps) {
  const common = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityLabel={accessibilityLabel} accessible={Boolean(accessibilityLabel)}>
      {name === 'home' ? <><Path {...common} d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><Path {...common} d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></> : null}
      {name === 'workout' ? <><Path {...common} d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z" /><Path {...common} d="m2.5 21.5 1.4-1.4" /><Path {...common} d="m20.1 3.9 1.4-1.4" /><Path {...common} d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z" /><Path {...common} d="m9.6 14.4 4.8-4.8" /></> : null}
      {name === 'coach' ? <><Path {...common} d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" /><Path {...common} d="M20 2v4M22 4h-4" /><Circle {...common} cx="4" cy="20" r="2" /></> : null}
      {name === 'meals' ? <><Path {...common} d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" /><Path {...common} d="M7 2v20" /><Path {...common} d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" /></> : null}
      {name === 'profile' ? <><Path {...common} d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><Circle {...common} cx="12" cy="7" r="4" /></> : null}
      {name === 'calendar' ? <><Path {...common} d="M8 2v4M16 2v4" /><Rect {...common} x="3" y="4" width="18" height="18" rx="2" /><Path {...common} d="M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" /></> : null}
      {name === 'flame' ? <Path {...common} d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" /> : null}
      {name === 'check' ? <><Circle {...common} cx="12" cy="12" r="10" /><Path {...common} d="m9 12 2 2 4-4" /></> : null}
      {name === 'target' ? <><Circle {...common} cx="12" cy="12" r="10" /><Path {...common} d="M22 12h-4M6 12H2M12 6V2M12 22v-4" /></> : null}
      {name === 'play' ? <Path {...common} d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" /> : null}
      {name === 'arrow-right' ? <><Path {...common} d="M5 12h14" /><Path {...common} d="m12 5 7 7-7 7" /></> : null}
      {name === 'refresh' ? <><Path {...common} d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><Path {...common} d="M21 3v5h-5" /><Path {...common} d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><Path {...common} d="M8 16H3v5" /></> : null}
      {name === 'bot' ? <><Path {...common} d="M12 8V4H8" /><Rect {...common} x="4" y="8" width="16" height="12" rx="2" /><Path {...common} d="M2 14h2M20 14h2M15 13v2M9 13v2" /></> : null}
      {name === 'paperclip' ? <Path {...common} d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" /> : null}
      {name === 'camera' ? <><Path {...common} d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" /><Circle {...common} cx="12" cy="13" r="3" /></> : null}
      {name === 'image' ? <><Rect {...common} x="3" y="3" width="18" height="18" rx="2" ry="2" /><Circle {...common} cx="8.5" cy="8.5" r="1.5" /><Path {...common} d="m21 15-5-5L5 21" /></> : null}
      {name === 'mic' ? <><Path {...common} d="M12 19v3M19 10v2a7 7 0 0 1-14 0v-2" /><Rect {...common} x="9" y="2" width="6" height="13" rx="3" /></> : null}
      {name === 'send' ? <><Path {...common} d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /><Path {...common} d="m21.854 2.147-10.94 10.939" /></> : null}
      {name === 'zap' ? <Path {...common} d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" /> : null}
    </Svg>
  );
}
