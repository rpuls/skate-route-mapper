import React from "react";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";

/**
 * The app's icon set.
 *
 * The designs are drawn with Material Symbols, which is a font. Loading an
 * icon font into a bare React Native app means shipping and registering a
 * ~300 KB binary and waiting for it before the first paint, so the handful of
 * glyphs this app actually uses are drawn as SVG instead. `react-native-svg`
 * is already a dependency, and paths render identically on iOS, Android and
 * web without a font-loading state.
 *
 * Every glyph is authored on Material's 24x24 grid so sizes, optical weight
 * and alignment match across the set. Add new ones on the same grid.
 */

export type IconName =
  | "add"
  | "back"
  | "bluetooth"
  | "camera"
  | "checkCircle"
  | "close"
  | "expandLess"
  | "expandMore"
  | "info"
  | "longboard"
  | "map"
  | "menu"
  | "myLocation"
  | "openInNew"
  | "pause"
  | "person"
  | "play"
  | "refresh"
  | "science"
  | "sensors"
  | "share"
  | "signOut"
  | "skateboard"
  | "skates"
  | "stop"
  | "timer"
  | "upload";

const paths: Partial<Record<IconName, string>> = {
  add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z",
  back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z",
  bluetooth:
    "M17.71 7.71 12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29zM13 5.83l1.88 1.88L13 9.59zm1.88 10.46L13 18.17v-3.76z",
  camera:
    "M9 2 7.17 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3.17L15 2zm3 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  checkCircle:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z",
  close:
    "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  expandLess: "M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z",
  expandMore: "M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z",
  info: "M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z",
  map: "M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11z",
  menu: "M3 18h18v-2H3zm0-5h18v-2H3zm0-7v2h18V6z",
  myLocation:
    "M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z",
  pause: "M6 19h4V5H6zm8-14v14h4V5z",
  person:
    "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  play: "M8 5v14l11-7z",
  refresh:
    "M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z",
  science:
    "M19.8 18.4 14 10.67V6.5l1.35-1.69A.5.5 0 0 0 14.96 4H9.04a.5.5 0 0 0-.39.81L10 6.5v4.17L4.2 18.4c-.49.66-.02 1.6.8 1.6h14c.82 0 1.29-.94.8-1.6z",
  sensors:
    "M7.76 16.24A5.98 5.98 0 0 1 6 12c0-1.66.67-3.16 1.76-4.24l1.42 1.42A3.99 3.99 0 0 0 8 12c0 1.1.45 2.1 1.17 2.83zm8.48 0A5.98 5.98 0 0 0 18 12c0-1.66-.67-3.16-1.76-4.24l-1.42 1.42A3.99 3.99 0 0 1 16 12c0 1.1-.45 2.1-1.17 2.83zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM4.93 19.07A9.97 9.97 0 0 1 2 12c0-2.76 1.12-5.26 2.93-7.07l1.42 1.42A7.94 7.94 0 0 0 4 12c0 2.21.9 4.21 2.35 5.65zm14.14 0A9.97 9.97 0 0 0 22 12c0-2.76-1.12-5.26-2.93-7.07l-1.42 1.42A7.94 7.94 0 0 1 20 12c0 2.21-.9 4.21-2.35 5.65z",
  share:
    "M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81a3 3 0 1 0-3-3c0 .24.04.47.09.7L8.04 9.81A2.99 2.99 0 0 0 6 9a3 3 0 0 0 0 6c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65a2.92 2.92 0 1 0 2.92-2.92z",
  signOut:
    "M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8v-2H4z",
  stop: "M6 6h12v12H6z",
  timer:
    "M15 1H9v2h6zm-4 13h2V8h-2zm8.03-6.61 1.42-1.42a11 11 0 0 0-1.41-1.41l-1.42 1.42A9 9 0 1 0 12 22a8.99 8.99 0 0 0 7.03-14.61zM12 20a7 7 0 1 1 0-14 7 7 0 0 1 0 14z",
  upload:
    "M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.99 5.99 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5z",
};

/**
 * Wheeled icons are drawn from parts rather than one path.
 *
 * Material has no inline-skate or longboard glyph that reads at 24px, and a
 * single path for a boot-plus-wheels ends up illegible at the sizes this app
 * uses. Composed shapes stay crisp and let the three ride types differ by
 * silhouette — the thing a rider actually scans for.
 */
function RideGlyph({ name, color }: { name: IconName; color: string }) {
  if (name === "skates") {
    return (
      <G>
        <Path
          d="M5 3h5.5a1.5 1.5 0 0 1 1.5 1.5V9l5.4 2.2A3 3 0 0 1 19 14v2H5z"
          fill={color}
        />
        <Rect x="4" y="17" width="16" height="1.6" rx="0.8" fill={color} />
        <Circle cx="8" cy="21" r="2" fill={color} />
        <Circle cx="16" cy="21" r="2" fill={color} />
      </G>
    );
  }

  if (name === "skateboard") {
    return (
      <G>
        <Path
          d="M3.2 9.6c0-.9.7-1.6 1.6-1.6h14.4a1.6 1.6 0 0 1 0 3.2H4.8c-.9 0-1.6-.7-1.6-1.6z"
          fill={color}
        />
        <Rect x="7" y="12" width="2" height="2.6" rx="1" fill={color} />
        <Rect x="15" y="12" width="2" height="2.6" rx="1" fill={color} />
        <Circle cx="8" cy="16.6" r="2.4" fill={color} />
        <Circle cx="16" cy="16.6" r="2.4" fill={color} />
      </G>
    );
  }

  return (
    <G>
      <Path
        d="M1.6 9.6c0-.9.7-1.6 1.6-1.6h17.6a1.6 1.6 0 0 1 0 3.2H3.2c-.9 0-1.6-.7-1.6-1.6z"
        fill={color}
      />
      <Rect x="5" y="12" width="2" height="2.6" rx="1" fill={color} />
      <Rect x="17" y="12" width="2" height="2.6" rx="1" fill={color} />
      <Circle cx="6" cy="16.6" r="2.4" fill={color} />
      <Circle cx="18" cy="16.6" r="2.4" fill={color} />
    </G>
  );
}

/**
 * Glyphs drawn as strokes rather than filled outlines.
 *
 * Material's own `open_in_new` is a hairline rectangle with a small arrow
 * leaving it — a 2000s toolbar icon. It reads as thin and fussy next to
 * typography at weight 900. A stroked arrow can carry the same weight as the
 * text it sits beside, which a filled outline of a box cannot.
 */
const strokeGlyphs: Partial<Record<IconName, string[]>> = {
  // A bold diagonal leaving the corner: "this takes you somewhere else".
  openInNew: ["M7.5 16.5 16.5 7.5", "M10 7.5H16.5V14"],
};

/** How heavy a stroked glyph is, on the same 24 grid. */
const strokeWeight = 3;

const composed: IconName[] = ["skates", "skateboard", "longboard"];

export function Icon({
  name,
  size = 24,
  color,
}: {
  name: IconName;
  size?: number;
  color: string;
}) {
  const strokes = strokeGlyphs[name];

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {strokes ? (
        <G>
          {strokes.map((d) => (
            <Path
              d={d}
              fill="none"
              key={d}
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={strokeWeight}
            />
          ))}
        </G>
      ) : composed.includes(name) ? (
        <RideGlyph name={name} color={color} />
      ) : (
        <Path d={paths[name] ?? paths.info!} fill={color} />
      )}
    </Svg>
  );
}

export default Icon;
