// Site-wide settings you may want to change without touching the components.

// ── Background images: one for the simple view, one for the full view ──
// Put image files in src/assets/ (any format the browser shows: .webp, .jpg, .png, .avif),
// import them here and use them below. Both views use the same images until you change one.
// desktop: the image (null: no image); mobile: used on screens narrower than 720px (reuse the
// desktop image if you have one size); position, size: CSS background-position / -size;
// fixed: true stays put while the page scrolls; fade: the tint laid over the image, so text
// stays readable (null: the default --bg-fade in src/styles.css).
import desktop from "./assets/background.webp";
import mobile from "./assets/background-small.webp";
import fullDesktop from "./assets/background.webp";
import fullMobile from "./assets/background-small.webp";

export const BACKGROUNDS = {
  simple: { desktop, mobile, position: "center top", size: "cover", fixed: true, fade: null },
  full:   { desktop: fullDesktop, mobile: fullMobile, position: "center top", size: "cover", fixed: true, fade: null },
};

// ── Footer ──
export const SITE_NAME = "morimens-gacha-calculator.github.io";
export const BANNERS_PATCH = "2.6.2.5"; // game version the built-in banners match; update with new patches
export const SOURCE_URL = "https://github.com/morimens-gacha-calculator/morimens-gacha-calculator.github.io"; // "Source code" link in the footer; null hides it

// ── Defaults ──
export const DEFAULT_PRESET = "limitedChar"; // a key from presets() in src/model.js
