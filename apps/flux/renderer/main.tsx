import React from "react";
import { createRoot } from "react-dom/client";
import { OverlayStackProvider } from "@lumacast/ui";
import { App } from "./App";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OverlayStackProvider>
      <App />
    </OverlayStackProvider>
  </React.StrictMode>,
);
