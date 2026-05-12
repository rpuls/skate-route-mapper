import React, { useState } from "react";
import {
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import {
  buttonVariants,
  colors,
  radius,
  shadows,
  space,
} from "@skate-route-mapper/shared/design";
import { useMobileAuth } from "../auth/MobileAuthContext";
import type { RootStackParamList } from "../navigation/AppNavigator";

type AppRouteName = keyof Pick<RootStackParamList, "Home" | "Rides" | "Auth">;

const menuItems: { label: string; routeName: AppRouteName }[] = [
  { label: "Start a Ride", routeName: "Home" },
  { label: "Saved Rides", routeName: "Rides" },
  { label: "Sign in/up", routeName: "Auth" },
];

export function AppMenuButton() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { user } = useMobileAuth();
  const [open, setOpen] = useState(false);

  const navigateTo = (routeName: AppRouteName) => {
    setOpen(false);
    navigation.navigate(routeName);
  };

  return (
    <>
      <Pressable
        accessibilityLabel="Open menu"
        onPress={() => setOpen(true)}
        style={styles.menuButton}
      >
        <View style={styles.menuLine} />
        <View style={styles.menuLine} />
        <View style={styles.menuLine} />
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}
      >
        <View style={styles.overlay}>
          <Pressable style={styles.scrim} onPress={() => setOpen(false)} />

          <SafeAreaView style={styles.drawer}>
            <View style={styles.drawerContent}>
              <View style={styles.drawerHeader}>
                <Pressable
                  accessibilityLabel="Close menu"
                  onPress={() => setOpen(false)}
                  style={styles.closeButton}
                >
                  <Text style={styles.closeText}>X</Text>
                </Pressable>
              </View>

              <View style={styles.menuList}>
                {menuItems.map((item) => {
                  const selected = route.name === item.routeName;

                  return (
                    <Pressable
                      key={item.routeName}
                      onPress={() => navigateTo(item.routeName)}
                      style={[styles.menuItem, selected && styles.menuItemSelected]}
                    >
                      <Text
                        style={[
                          styles.menuItemText,
                          selected && styles.menuItemTextSelected,
                        ]}
                      >
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.accountPanel}>
                <Text style={styles.accountLabel}>Account</Text>
                <Text style={styles.accountText}>
                  {user ? user.email : "Not signed in"}
                </Text>
              </View>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

export function ScreenHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.screenHeader}>
      <View style={styles.screenTopRow}>
        <View>
          <Text style={styles.appName}>Skate Route Mapper</Text>
          <Text style={styles.screenTitle}>{title}</Text>
        </View>
        <AppMenuButton />
      </View>

      <Text style={styles.screenSubtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screenHeader: {
    marginTop: 16,
    marginBottom: 8,
    gap: 10,
  },
  screenTopRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 16,
    justifyContent: "space-between",
  },
  appName: {
    color: colors.textOnOrange,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 12,
    opacity: 0.82,
  },
  screenTitle: {
    color: colors.textOnOrange,
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 39,
  },
  screenSubtitle: {
    color: colors.textOnOrange,
    fontSize: 16,
    lineHeight: 23,
    opacity: 0.82,
  },
  menuButton: {
    alignItems: "center",
    backgroundColor: buttonVariants.primary.filled.backgroundColor,
    borderColor: buttonVariants.primary.filled.borderColor,
    borderRadius: radius.lg,
    borderWidth: 2,
    height: 48,
    justifyContent: "center",
    width: 48,
    ...shadows.tile,
  },
  menuLine: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    height: 3,
    marginVertical: 3,
    width: 20,
  },
  overlay: {
    flex: 1,
    flexDirection: "row",
  },
  scrim: {
    backgroundColor: "rgba(23, 17, 12, 0.42)",
    flex: 1,
  },
  drawer: {
    backgroundColor: colors.page,
    bottom: 0,
    position: "absolute",
    right: 0,
    top: 0,
    width: 312,
  },
  drawerContent: {
    flex: 1,
    padding: space.lg,
  },
  drawerHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 20,
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  closeText: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: "900",
  },
  menuList: {
    gap: 12,
  },
  menuItem: {
    backgroundColor: "transparent",
    borderColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    minHeight: 54,
    justifyContent: "center",
    paddingHorizontal: space.lg,
  },
  menuItemSelected: {
    backgroundColor: colors.surface,
    borderColor: colors.surface,
  },
  menuItemText: {
    color: colors.textOnOrange,
    fontSize: 18,
    fontWeight: "900",
  },
  menuItemTextSelected: {
    color: colors.accent,
  },
  accountPanel: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginTop: "auto",
    padding: space.lg,
  },
  accountLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 6,
  },
  accountText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
});
