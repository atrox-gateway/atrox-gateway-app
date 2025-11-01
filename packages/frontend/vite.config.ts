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
  },
  // Build optimizations: split large vendor libraries into manual chunks
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Keep a conservative single vendor chunk to avoid circular chunk dependencies
        // that can cause runtime issues (e.g. createContext undefined). If we need
        // more fine-grained splitting later, reintroduce manual chunking but ensure
        // packages that depend on React are grouped together.
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        }
      }
    }
  }
}));
