export const Theme = {
  colors: {
    // Primary palette — deep, trustworthy, premium
    primary: '#1a56db',       // Royal Blue
    primaryDark: '#1e3a8a',   // Deep Navy
    primaryLight: '#60a5fa',  // Light Blue
    secondary: '#7c3aed',     // Violet accent

    // Clinical indicators — warm, supportive
    success: '#059669',   // Emerald — All clear
    warning: '#d97706',   // Amber — Keep watch
    error: '#dc2626',     // Red — See a doctor
    info: '#0891b2',      // Cyan — Informational

    // Background system
    background: '#f8fafc',
    backgroundAlt: '#f0f4ff',
    surface: '#ffffff',
    surfaceDim: '#f1f5f9',
    glass: 'rgba(255,255,255,0.88)',
    glassDark: 'rgba(26,86,219,0.85)',

    // Gradient endpoints (for LinearGradient if used, or use in style objects)
    gradientStart: '#1a56db',
    gradientEnd: '#7c3aed',

    // Text
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    textTertiary: '#94a3b8',
    textInverse: '#ffffff',
    textMuted: '#cbd5e1',

    // Borders
    border: '#bfdbfe',
    borderLight: '#e2e8f0',
    borderStrong: '#93c5fd',
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
    xxxl: 64,
  },

  borderRadius: {
    xs: 6,
    sm: 10,
    md: 14,
    lg: 20,
    xl: 28,
    xxl: 40,
    full: 9999,
  },

  typography: {
    h1: {
      fontSize: 32,
      fontWeight: '800' as const,
      lineHeight: 40,
      letterSpacing: -0.5,
    },
    h2: {
      fontSize: 26,
      fontWeight: '700' as const,
      lineHeight: 32,
      letterSpacing: -0.3,
    },
    h3: {
      fontSize: 20,
      fontWeight: '700' as const,
      lineHeight: 26,
    },
    body: {
      fontSize: 16,
      fontWeight: '400' as const,
      lineHeight: 24,
    },
    bodyBold: {
      fontSize: 16,
      fontWeight: '600' as const,
      lineHeight: 24,
    },
    caption: {
      fontSize: 14,
      fontWeight: '500' as const,
      lineHeight: 20,
    },
    captionSmall: {
      fontSize: 12,
      fontWeight: '500' as const,
      lineHeight: 16,
    },
    label: {
      fontSize: 12,
      fontWeight: '700' as const,
      lineHeight: 16,
      letterSpacing: 0.6,
      textTransform: 'uppercase' as const,
    },
    display: {
      fontSize: 42,
      fontWeight: '800' as const,
      lineHeight: 50,
      letterSpacing: -1,
    },
  },

  shadows: {
    soft: {
      shadowColor: '#1a56db',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.06,
      shadowRadius: 12,
      elevation: 2,
    },
    medium: {
      shadowColor: '#1a56db',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.1,
      shadowRadius: 24,
      elevation: 5,
    },
    strong: {
      shadowColor: '#0f172a',
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.14,
      shadowRadius: 40,
      elevation: 10,
    },
    colored: (color: string) => ({
      shadowColor: color,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.25,
      shadowRadius: 20,
      elevation: 6,
    }),
  },

  animation: {
    fast: 150,
    normal: 280,
    slow: 450,
    spring: { damping: 18, stiffness: 200 },
  },
};
