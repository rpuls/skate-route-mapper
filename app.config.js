import appJson from "./app.json";

export default {
  ...appJson,
  expo: {
    ...appJson.expo,

    android: {
      ...appJson.expo.android,
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GMAPS_ANDROID_KEY
        }
      }
    },

    ios: {
      ...appJson.expo.ios,
      config: {
        googleMapsApiKey: process.env.EXPO_PUBLIC_GMAPS_IOS_KEY
      }
    }
  }
};