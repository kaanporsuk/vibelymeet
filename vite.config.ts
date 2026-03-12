import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Ensure single React instance (avoids "dispatcher is null" / invalid hook / useAuth context loss).
    // @vitejs/plugin-react-swc does not dedupe automatically; duplicate React breaks context and hooks.
    dedupe: ["react", "react-dom"],
  },
}));
