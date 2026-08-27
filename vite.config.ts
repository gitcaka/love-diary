import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";
const SITE_CREATOR_PLACEHOLDER_KV_NAMESPACE_ID =
  "00000000000000000000000000000000";

const { d1 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: process.env.CLOUDFLARE_D1_DATABASE_NAME ?? "love-diary",
          database_id: process.env.CLOUDFLARE_D1_DATABASE_ID ?? SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          migrations_dir: "../.openai/drizzle",
        },
      ]
    : [],
  kv_namespaces: [
    {
      binding: "MEDIA",
      id: process.env.CLOUDFLARE_MEDIA_KV_NAMESPACE_ID ?? SITE_CREATOR_PLACEHOLDER_KV_NAMESPACE_ID,
    },
  ],
};

export default defineConfig(async ({ command }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: {
          ...localBindingConfig,
          vars: command === "serve" ? { DIARY_WRITE_KEY: "local-dev-key" } : {},
        },
      }),
    ],
  };
});
