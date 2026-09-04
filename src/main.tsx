import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/dm-mono/latin-400.css";
import "@fontsource/dm-mono/latin-500.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-ext-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-ext-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-ext-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-ext-700.css";
import { App } from "./App";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("OneShare root element is missing.");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
