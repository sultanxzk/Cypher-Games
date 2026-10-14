import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    // Shown in the footer of the loading screen (MM/DD/YYYY).
    define: {
      __BUILD_DATE__: JSON.stringify(
        `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`,
      ),
    },
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
