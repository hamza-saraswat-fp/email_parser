import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FpAuthProvider, RequireAuth } from "@fieldpulse/auth/react";
import "./index.css";
import { authEnabled } from "./lib/auth";
import App from "./App";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1_000, retry: 1 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {authEnabled ? (
        <FpAuthProvider>
          <RequireAuth appName="Email Parser">
            <App />
          </RequireAuth>
        </FpAuthProvider>
      ) : (
        <App />
      )}
    </QueryClientProvider>
  </StrictMode>,
);
