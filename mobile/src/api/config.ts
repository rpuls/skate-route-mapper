const configuredApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

export const mobileApiBaseUrl = (
  configuredApiBaseUrl ?? "https://skate-route-mapper-api.up.railway.app"
).replace(/\/$/, "");
