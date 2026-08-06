import { Redirect } from 'expo-router';

/** Keeps older links working while authentication now lives on one screen. */
export default function SignUpScreen() {
  return <Redirect href={{ pathname: '/sign-in', params: { mode: 'signup' } }} />;
}
