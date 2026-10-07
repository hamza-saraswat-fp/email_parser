import { defineConfig } from "vitest/config";

// Dummy values so unit tests never depend on a developer's .env. Nothing under
// `npm test` talks to a live service.
export default defineConfig({
  test: {
    env: {
      OPENROUTER_API_KEY: "test-dummy-key",
      AGENTMAIL_API_KEY: "test-dummy-key",
      SUPABASE_URL: "http://localhost:54321",
      SUPABASE_SERVICE_KEY: "test-dummy-service-key",
      PARSER_INBOX_IDS: "parser-dev@agent.fieldpulse.com",
    },
    include: ["src/**/*.test.ts"],
  },
});
