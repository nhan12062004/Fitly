import { Linking } from 'react-native';

export const openInitialAssessment = () =>
  Linking.openURL('https://trend-fit.vercel.app/assessment/survey');
