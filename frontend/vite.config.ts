import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@artifacts": path.resolve(
        __dirname,
        "../contracts/target/dev",
      ),
    },
  },
  // Starknet.js uses Node.js crypto — polyfill for browser
  define: {
    global: "globalThis",
  },
});
