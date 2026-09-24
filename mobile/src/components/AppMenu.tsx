import React, { useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  buttonVariants,
  colors,
  controlSize,
  radius,
  space,
} from "@skate-route-mapper/shared/design";
import { useMobileAuth } from "../auth/MobileAuthContext";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { Icon, type IconName } from "./Icon";

type AppRouteName = keyof Pick<
  RootStackParamList,
  "StartRide" | "Research" | "Rides" | "Auth"
>;

type MenuItem = {
  label: string;
  description: string;
  icon: IconName;
  routeName: AppRouteName;
};

/**
 * The drawer is the app's map, so it lists everything — including the parts a
 * rider should not trip over on the way to a ride.
 *
 * Research collection is a lab tool: it needs a XIAO board, a labelled
 * experiment and a file transfer afterwards. It used to be the first tile on
 * the start screen, ahead of the button most people opened the app for. It
 * lives here now, findable but out of the way.
 */
const menuItems: MenuItem[] = [
  {
    label: "Start a ride",
    description: "Record a route",
    icon: "map",
    routeName: "StartRide",
  },
  {
    label: "Saved rides",
    description: "Everything recorded on this phone",
    icon: "timer",
    routeName: "Rides",
  },
  {
    label: "Research lab",
    description: "Labelled high-rate XIAO captures",
    icon: "science",
    routeName: "Research",
  },
];

export function AppMenuButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        accessibilityLabel="Open menu"
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}
      >
        <Icon color={colors.accent} name="menu" size={24} />
      </Pressable>

      <AppMenuDrawer onClose={() => setOpen(false)} open={open} />
    </>
  );
}

function AppMenuDrawer({
  onClose,
  open,
}: {
  onClose: () => void;
  open: boolean;
}) {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { user } = useMobileAuth();

  const go = (routeName: AppRouteName) => {
    onClose();

    // `navigate` rather than `push`: the drawer moves between the app's places
    // rather than stacking them, so going back from one never walks through a
    // trail of the same screen.
    if (route.name !== routeName) {
      navigation.navigate(routeName);
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      // The drawer pads itself by the top inset, which only lines up if the
      // modal actually covers the status bar. On Android it does not without
      // this.
      statusBarTranslucent
      transparent
      visible={open}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="Close menu"
          onPress={onClose}
          style={styles.scrim}
        />

        <View
          style={[
            styles.drawer,
            { paddingBottom: space.lg + insets.bottom, paddingTop: insets.top + space.md },
          ]}
        >
          <View style={styles.drawerHeader}>
            <Text style={styles.drawerTitle}>Skate Route Mapper</Text>

            <Pressable
              accessibilityLabel="Close menu"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <Icon color={colors.accent} name="close" size={22} />
            </Pressable>
          </View>

          <View style={styles.menuList}>
            {menuItems.map((item) => {
              const selected = route.name === item.routeName;

              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={item.routeName}
                  onPress={() => go(item.routeName)}
                  style={({ pressed }) => [
                    styles.menuItem,
                    selected && styles.menuItemSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <View
                    style={[styles.menuIcon, selected && styles.menuIconSelected]}
                  >
                    <Icon
                      color={selected ? colors.accent : colors.textOnOrange}
                      name={item.icon}
                      size={22}
                    />
                  </View>

                  <View style={styles.menuCopy}>
                    <Text
                      style={[
                        styles.menuItemText,
                        selected && styles.menuItemTextSelected,
                      ]}
                    >
                      {item.label}
                    </Text>
                    <Text
                      style={[
                        styles.menuItemDetail,
                        selected && styles.menuItemDetailSelected,
                      ]}
                    >
                      {item.description}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => go("Auth")}
            style={({ pressed }) => [styles.accountPanel, pressed && styles.pressed]}
          >
            <View style={styles.accountIcon}>
              <Icon color={colors.accent} name="person" size={22} />
            </View>

            <View style={styles.menuCopy}>
              <Text style={styles.accountLabel}>
                {user ? "Signed in" : "Not signed in"}
              </Text>
              <Text style={styles.accountText} numberOfLines={1}>
                {user ? user.email : "Sign in to back up and sync"}
              </Text>
            </View>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  menuButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    height: controlSize.sm,
    justifyContent: "center",
    width: controlSize.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  overlay: {
    flex: 1,
    flexDirection: "row",
  },
  scrim: {
    backgroundColor: colors.scrim,
    flex: 1,
  },
  drawer: {
    backgroundColor: colors.page,
    bottom: 0,
    gap: space.xl,
    paddingHorizontal: space.lg,
    position: "absolute",
    right: 0,
    top: 0,
    width: 312,
  },
  drawerHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.md,
    justifyContent: "space-between",
  },
  drawerTitle: {
    color: colors.textOnOrange,
    flex: 1,
    fontSize: 16,
    fontWeight: "900",
    opacity: 0.82,
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  menuList: {
    gap: space.md,
  },
  menuItem: {
    alignItems: "center",
    borderColor: buttonVariants.secondary.contained.borderColor,
    borderRadius: radius.lg,
    borderWidth: 2,
    flexDirection: "row",
    gap: space.md,
    minHeight: 64,
    paddingHorizontal: space.md,
  },
  menuItemSelected: {
    backgroundColor: colors.surface,
    borderColor: colors.surface,
  },
  menuIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceOnPage,
    borderRadius: radius.sm,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  menuIconSelected: {
    backgroundColor: colors.surfaceWarm,
  },
  menuCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  menuItemText: {
    color: colors.textOnOrange,
    fontSize: 17,
    fontWeight: "900",
  },
  menuItemTextSelected: {
    color: colors.text,
  },
  menuItemDetail: {
    color: colors.textOnOrange,
    fontSize: 12,
    fontWeight: "700",
    opacity: 0.78,
  },
  menuItemDetailSelected: {
    color: colors.textMuted,
    opacity: 1,
  },
  accountPanel: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    flexDirection: "row",
    gap: space.md,
    marginTop: "auto",
    padding: space.md,
  },
  accountIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.sm,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  accountLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  accountText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
});
