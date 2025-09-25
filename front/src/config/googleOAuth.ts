export const GOOGLE_OAUTH_CONFIG = {
  /**
   * Preencha com os client IDs gerados no Google Cloud Console
   * (OAuth client type Web/Android/iOS conforme o seu app).
   */
  expoClientId: process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID ?? "",
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? "",
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "",
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "667142179340-mqur2t4h0lc5gmobt3mj1iuoqhojkocn.apps.googleusercontent.com",
  /**
   * Escopos solicitados no consentimento.
   */
  scopes: [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar",
  ],
};
