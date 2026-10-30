import React from "react";
import { createRoot } from "react-dom/client";
import { ConfirmProvider, OverlayStackProvider } from "@lumacast/ui";
import { App } from "./App";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OverlayStackProvider>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </OverlayStackProvider>
  </React.StrictMode>,
);
