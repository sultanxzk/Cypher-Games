import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    // "/" = site served from the root of your domain.
    // If it lives in a subfolder, set VITE_BASE=/subfolder/ in .env
    base: env.VITE_BASE || "/",
    server: {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    },
  };
});
