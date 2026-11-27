import { lazy, Suspense, useEffect, useState } from "react";
import App from "./App.jsx";
import { hrefOf, whereAmI } from "./components/SiteParts.jsx";

// The calculators: which one is open follows the address (the pull calculator at the root,
// the covenant one at covenant/). Switching keeps the page and changes the address; Back works.
const CovenantApp = lazy(() => import("./covenant/CovenantApp.jsx"));

export default function Site() {
  const [calc, setCalc] = useState(() => whereAmI().calc);
  useEffect(() => {
    const back = () => setCalc(whereAmI().calc);
    addEventListener("popstate", back);
    return () => removeEventListener("popstate", back);
  }, []);
  const go = (key) => {
    if (key === calc) return;
    history.pushState(null, "", hrefOf(whereAmI().root, key));
    setCalc(key);
    scrollTo(0, 0);
  };
  if (calc === "covenant") return <Suspense fallback={null}><CovenantApp onGo={go} /></Suspense>;
  return <App onGo={go} />;
}
