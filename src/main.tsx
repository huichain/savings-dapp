import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ClientProvider } from "@solana/react";
import { client } from "./lib/client";
import { LocaleProvider } from "./i18n/locale";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleProvider>
      <ClientProvider client={client}>
        <App />
      </ClientProvider>
    </LocaleProvider>
  </StrictMode>
);
