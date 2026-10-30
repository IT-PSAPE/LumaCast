import React from "react";
import { createRoot } from "react-dom/client";
import { ConfirmProvider } from "@lumacast/ui";
import { App } from "./App";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("renderer root element not found");

createRoot(root).render(
  <React.StrictMode>
    <ConfirmProvider><App /></ConfirmProvider>
  </React.StrictMode>,
);
