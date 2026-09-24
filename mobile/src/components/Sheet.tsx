import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  colors,
  controlSize,
  radius,
  shadows,
  space,
} from "@skate-route-mapper/shared/design";

const openMs = 260;
const closeMs = 200;

/**
 * A bottom sheet for a choice that belongs to the screen behind it.
 *
 * Picking a ride type or a sensor is a detour, not a destination: pushing a
 * route for it would put a recording screen behind a stack entry and give the
 * back button two different meanings. A sheet keeps the screen underneath
 * visible and dismisses the same way every time — scrim, hardware back, or the
 * grabber.
 *
 * The two layers are animated separately, which is why `Modal` is told not to
 * animate at all. `animationType="slide"` moves everything the modal contains,
 * so the scrim slid up from the bottom with the sheet — a dimming that arrives
 * as a moving edge reads as a second panel rather than as the room going dark.
 * The scrim fades in across the whole screen; only the sheet travels.
 */
export function Sheet({
  children,
  onClose,
  subtitle,
  title,
  visible,
}: {
  children: React.ReactNode;
  onClose: () => void;
  subtitle?: string;
  title: string;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  // The modal has to outlive `visible` long enough to animate out.
  const [mounted, setMounted] = useState(visible);
  const [sheetHeight, setSheetHeight] = useState(
    () => Dimensions.get("window").height
  );

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }

    Animated.timing(progress, {
      toValue: 0,
      duration: closeMs,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setMounted(false);
      }
    });
  }, [progress, visible]);

  useEffect(() => {
    if (!mounted || !visible) {
      return;
    }

    Animated.timing(progress, {
      toValue: 1,
      duration: openMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [mounted, progress, visible]);

  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      // Without this the scrim stops at the status bar on Android, so the
      // screen is dimmed everywhere except the one strip along the top.
      statusBarTranslucent
      transparent
      visible={mounted}
    >
      <View style={styles.root}>
        <Animated.View style={[styles.scrim, { opacity: progress }]}>
          <Pressable
            accessibilityLabel="Close"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <Animated.View
          onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
          style={[
            styles.sheet,
            { paddingBottom: space.xl + insets.bottom },
            {
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [sheetHeight, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Pressable
            accessibilityLabel="Close"
            accessibilityRole="button"
            onPress={onClose}
            style={styles.grabberTarget}
          >
            <View style={styles.grabber} />
          </Pressable>

          <View style={styles.heading}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>

          <ScrollView
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.body}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  scrim: {
    backgroundColor: colors.scrim,
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    // A sheet must never grow past the screen, or its actions leave the view.
    maxHeight: "86%",
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    ...shadows.sheet,
  },
  grabberTarget: {
    alignItems: "center",
    height: controlSize.xs,
    justifyContent: "center",
  },
  grabber: {
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    height: 5,
    width: 40,
  },
  heading: {
    gap: 6,
    paddingBottom: space.lg,
  },
  title: {
    color: colors.text,
    fontSize: 27,
    fontWeight: "900",
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    gap: space.md,
    paddingBottom: space.xs,
  },
});

export default Sheet;
