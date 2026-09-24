import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  colors,
  radius,
  shadows,
  space,
} from "@skate-route-mapper/shared/design";
import { Icon } from "./Icon";

/** The white tile the whole app is built from. */
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/**
 * A card whose body can be folded away.
 *
 * A phone screen holds about one and a half tiles of detail. When a screen has
 * four things to say, showing all of them means the one that is currently
 * changing — a running timer, a transfer percentage — sits below the fold
 * where nobody can see it. Collapsing the sections that are merely *set*
 * keeps the section that is *happening* on screen.
 *
 * The header stays readable when closed: `summary` carries the chosen values,
 * so folding a section hides its controls without hiding its state.
 */
export function CollapsibleCard({
  children,
  onToggle,
  open,
  style,
  summary,
  title,
  trailing,
}: {
  children: React.ReactNode;
  onToggle: () => void;
  open: boolean;
  style?: StyleProp<ViewStyle>;
  summary?: string;
  title: string;
  trailing?: React.ReactNode;
}) {
  return (
    <View style={[styles.card, styles.collapsibleCard, style]}>
      <Pressable
        accessibilityLabel={`${open ? "Collapse" : "Expand"} ${title}`}
        accessibilityRole="button"
        onPress={onToggle}
        style={styles.header}
      >
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{title}</Text>
          {summary && !open ? (
            <Text style={styles.summary} numberOfLines={2}>
              {summary}
            </Text>
          ) : null}
        </View>

        {trailing}

        <View style={styles.chevron}>
          <Icon
            color={colors.accent}
            name={open ? "expandLess" : "expandMore"}
            size={22}
          />
        </View>
      </Pressable>

      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    gap: space.md,
    padding: space.lg,
    ...shadows.tile,
  },
  collapsibleCard: {
    gap: 0,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.md,
    minHeight: 32,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  summary: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  chevron: {
    alignItems: "center",
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.pill,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  body: {
    gap: space.md,
    paddingTop: space.lg,
  },
});

export default Card;
