import React from "react";
import ReactDOM from "react-dom/client";
import Shell from "./design/Shell";
import "./styles/globals.css";
// Self-installs when ?embedded=1 — namespaces localStorage by project
// and applies theme tokens posted from the parent frame. No-op for
// standalone use.
import "./embedded.js";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Shell />
  </React.StrictMode>
);
