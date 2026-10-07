import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppearanceProvider } from "./components/AppearanceProvider";
import "@fontsource/roboto/latin-400.css";
import "@fontsource/roboto/latin-500.css";
import "@fontsource/roboto/latin-700.css";
import "./styles.css";
import "./platforms.css";
import { initializeMobileDrive } from "./lib/mobileDrive";

function render() {
  createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppearanceProvider>
        <App />
      </AppearanceProvider>
    </React.StrictMode>,
  );
}
if (import.meta.env.VITE_NATIVE_APP) void initializeMobileDrive().then(render);
else render();

if ("serviceWorker" in navigator && import.meta.env.PROD && !import.meta.env.VITE_NATIVE_APP) {
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}
