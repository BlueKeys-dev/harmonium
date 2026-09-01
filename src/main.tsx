import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { engine } from "./audioEngine";
import { scorePlayer } from "./scorePlayer";
import "./index.css";

if (import.meta.env.DEV) {
  // Debug-only hook for local runtime inspection.
  (window as unknown as Record<string, unknown>).__harmonium = { engine, scorePlayer };
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
