import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { App } from "./app.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("no #root element in index.html");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
