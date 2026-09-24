import React from "react";
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  colors,
  controlSize,
  layout as layoutTokens,
  radius,
  shadowBleed,
  space,
} from "@skate-route-mapper/shared/design";
import { AppMenuButton } from "./AppMenu";
import { Icon } from "./Icon";

/**
 * The page frame every screen is built in.
 *
 * Screens used to assemble their own chrome, and the result was a header whose
 * layout depended on how long its title happened to be: a title with no room
 * to shrink pushed the menu button off the right edge of the phone. That is
 * the failure this component exists to make impossible.
 *
 * The frame is deliberately small. Two things are standard on every page — the
 * title and the drawer button — and they share the top line:
 *
 *     Ready to roll                                   [☰]
 *
 * The title takes the space that is left and wraps; the button never shrinks
 * and never moves. Everything else on a page is the screen's own content,
 * starting immediately under the header, so a screen-specific control sits
 * next to whatever it belongs to rather than being smuggled into the frame.
 *
 * Navigation is the drawer. A page listed in the drawer therefore has no back
 * button: it is a place, and you get to it the same way every time.
 *
 *     [←] Live detail                                 [☰]
 *
 * A page you *drill into* is different. It is not in the drawer, so it was
 * opened from somewhere, and it opts in with `back`. The swipe gesture already
 * works there, but a gesture is invisible and not everyone knows it exists, so
 * the way out has to be something you can see.
 *
 * ## Shadows are never clipped
 *
 * A scrolling container clips to its own bounds, and a shadow is drawn outside
 * the box that casts it. Give a scroll view less padding than the shadow
 * reaches and the soft warm shadow is sliced off flat — a hard line down the
 * side of a tile, or across the top of the first one.
 *
 * Two things together make that impossible here rather than merely unlikely:
 *
 *   1. The gutter never goes on the scroll view, only on its content. An inset
 *      viewport clips at the tile's own edge, where it is most obvious.
 *   2. `shadowBleed` says how far a tile's shadow actually reaches, computed
 *      from the shadow itself, and `scrollContentInsets` reserves exactly that
 *      on every side. Change the shadow and the reserved space follows.
 *
 * `layout="scroll"` applies both. A screen that brings its own scroll view — a
 * `FlatList`, say — passes `padded={false}` and spreads `scrollContentInsets`
 * into that list's `contentContainerStyle`.
 */

/**
 * The page's side gutter.
 *
 * Wide enough for a tile's shadow by construction — see `layout.screenPadding`
 * in the design tokens.
 */
export const pageGutter = layoutTokens.screenPadding;

/**
 * Content-container padding that keeps a tile's shadow off a scroll view's
 * edges, on all four sides.
 *
 * Spread this into the `contentContainerStyle` of any scroll view that holds
 * tiles. A screen may add to the bottom for the home indicator; it must not
 * take away.
 */
export const scrollContentInsets = {
  paddingTop: shadowBleed.tile.top,
  paddingBottom: shadowBleed.tile.bottom,
  paddingHorizontal: pageGutter,
} as const;

export type PageLayout = "scroll" | "fill";

type PageProps = {
  /** The page name. Wraps; never shrinks the drawer button. */
  title: string;
  subtitle?: string;
  /**
   * Show a back arrow left of the title.
   *
   * For a page that is drilled into rather than listed in the drawer. A drawer
   * destination must not set this: it has nowhere meaningful to go back to,
   * and an arrow that sometimes means "up" and sometimes means "wherever you
   * happened to come from" is worse than no arrow.
   */
  back?: boolean;
  layout?: PageLayout;
  /**
   * Turn off to let the body run edge to edge.
   *
   * Required when the screen supplies its own scroll view, which has to span
   * the full width so it does not clip its cards' shadows. See "The gutter
   * rule" above.
   */
  padded?: boolean;
  /** Pinned below the body, outside the scroll area. */
  footer?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

export function Page({
  title,
  subtitle,
  back = false,
  layout = "scroll",
  padded = true,
  footer,
  contentStyle,
  children,
}: PageProps) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const body =
    layout === "fill" ? (
      <View style={[styles.fill, padded && styles.bodyPadded, contentStyle]}>
        {children}
      </View>
    ) : (
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          padded && styles.scrollInsets,
          // A pinned footer already clears the home indicator, so only an
          // unfooted page has to pad for it itself. The safe area and the
          // shadow's own room serve different purposes at the same edge, so
          // take the larger rather than stacking them and losing a thumb's
          // worth of screen.
          !footer && {
            paddingBottom: Math.max(
              scrollContentInsets.paddingBottom,
              insets.bottom + space.lg
            ),
          },
          contentStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.fill}
      >
        {children}
      </ScrollView>
    );

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent
      />

      <View style={styles.header}>
        <View style={styles.titleRow}>
          {back && navigation.canGoBack() ? (
            <Pressable
              accessibilityLabel="Go back"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => navigation.goBack()}
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.pressed,
              ]}
            >
              <Icon color={colors.textOnOrange} name="back" size={24} />
            </Pressable>
          ) : null}

          {/* The title block is what flexes. Giving it a minimum height equal
              to the button keeps a one-line title optically level with it,
              while a wrapping title grows downward instead of squeezing it. */}
          <View style={styles.titleBox}>
            <Text style={styles.title}>{title}</Text>
          </View>

          <AppMenuButton />
        </View>

        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      {body}

      {footer ? (
        <View
          style={[
            styles.footer,
            padded && styles.bodyPadded,
            // The home indicator already holds this space open, so the
            // footer's own padding only has to cover the case where there is
            // no indicator. Stacking both wastes the bottom of every screen.
            { paddingBottom: Math.max(space.lg, insets.bottom) },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A status pill for the orange page, such as the GPS readiness badge.
 *
 * It lives here because it is shaped by the page background rather than by any
 * one screen, but it is placed by the screen: a pill about the map belongs
 * directly above the map, not in the header.
 */
export function StatusPill({
  dotColor,
  label,
}: {
  dotColor: string;
  label: string;
}) {
  return (
    <View style={styles.pill}>
      <View style={[styles.pillDot, { backgroundColor: dotColor }]} />
      <Text style={styles.pillText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.page,
    flex: 1,
  },
  fill: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    gap: space.sm,
    paddingBottom: space.md,
    paddingHorizontal: pageGutter,
    paddingTop: space.sm,
  },
  titleRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: space.md,
  },
  backButton: {
    alignItems: "center",
    height: controlSize.sm,
    justifyContent: "center",
    // Pulled into the gutter so the title still starts on the page's left
    // margin rather than being indented by the arrow.
    marginLeft: -space.sm,
    width: controlSize.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  titleBox: {
    flex: 1,
    justifyContent: "center",
    minHeight: controlSize.sm,
    minWidth: 0,
  },
  title: {
    color: colors.textOnOrange,
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 33,
  },
  subtitle: {
    color: colors.textOnOrange,
    fontSize: 15,
    lineHeight: 22,
    opacity: 0.82,
  },
  scrollContent: {
    gap: space.lg,
  },
  bodyPadded: {
    paddingHorizontal: pageGutter,
  },
  scrollInsets: scrollContentInsets,
  footer: {
    gap: space.md,
    paddingTop: space.md,
  },
  pill: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceOnPage,
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: space.sm,
    maxWidth: "100%",
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  pillDot: {
    borderRadius: radius.pill,
    height: 8,
    width: 8,
  },
  pillText: {
    color: colors.textOnOrange,
    fontSize: 14,
    fontWeight: "800",
    flexShrink: 1,
  },
});

export default Page;
