export const tokens = {
  colors: {
    ink: '#EEF8F0',
    muted: '#9AAC9D',
    canvas: '#0B1310',
    surface: '#142019',
    surfaceRaised: '#1A2B21',
    border: '#294334',
    lime: '#B7F96B',
    limePressed: '#9DDB57',
    coral: '#FF8F73',
    danger: '#FF7262',
    white: '#FFFFFF',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, hero: 48 },
  radius: { sm: 10, md: 16, lg: 24, pill: 999 },
  type: {
    overline: 12,
    body: 15,
    label: 16,
    title: 28,
    display: 40,
  },
  shadow: {
    card: {
      shadowColor: '#000000',
      shadowOpacity: 0.22,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 5,
    },
  },
} as const;
