import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { engine } from "./audioEngine";
import { scorePlayer } from "./scorePlayer";
import "./index.css";

// Debug/agent hook: lets tests and in-page agents inspect the live engine.
(window as unknown as Record<string, unknown>).__harmonium = { engine, scorePlayer };

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
