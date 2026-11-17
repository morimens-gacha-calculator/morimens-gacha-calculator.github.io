import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
// fonts, served by the site itself: Inter for everything, JetBrains Mono for the banner data editor
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "./styles.css";

// How the page is being used right now: "mouse" after a click or tap, "keyboard" after a
// navigation key. Dropdowns keep focus after a pick (so the keyboard can carry on from there),
// and styles.css highlights a focused dropdown only while the keyboard is in use.
const setInput = (how) => { if (document.documentElement.dataset.input !== how) document.documentElement.dataset.input = how; };
document.addEventListener("pointerdown", () => setInput("mouse"), true);
document.addEventListener("keydown", (e) => { if (["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " ", "Home", "End"].includes(e.key)) setInput("keyboard"); }, true);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
