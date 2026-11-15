// Site-wide settings you may want to change without touching the components.

// ── Background image ──
// Replace the files in src/assets/ (any format the browser shows: .webp, .jpg, .png, .avif)
// and point these imports at them. Set `desktop: null` for no image.
// `mobile` is used on screens narrower than 720px; reuse the desktop image if you have one size.
// The tint laid over the image is --bg-fade in src/styles.css (one value per theme).
import desktop from "./assets/background.png";
import mobile from "./assets/background-small.png";

export const BACKGROUND = {
  desktop,
  mobile,
  position: "center top",   // CSS background-position, e.g. "center", "right top"
  size: "cover",            // CSS background-size, e.g. "cover", "contain", "1920px auto"
  fixed: true,              // true: stays put while the page scrolls
};

// ── Footer ──
export const SITE_NAME = "morimens-gacha-calculator.github.io";
export const BANNERS_PATCH = "2.6.5"; // game version the built-in banners match; update with new patches
export const SOURCE_URL = "https://github.com/morimens-gacha-calculator/morimens-gacha-calculator.github.io"; // "Source code" link in the footer; null hides it

// ── Defaults ──
export const DEFAULT_THEME = "dark";     // "dark" or "light"
export const DEFAULT_PRESET = "limitedChar"; // a key from presets() in src/model.js
