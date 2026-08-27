import React from "react";
import { createRoot } from "react-dom/client";
import LoveDiaryApp from "@/components/LoveDiaryApp";
import "@/app/globals.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LoveDiaryApp />
  </React.StrictMode>,
);
