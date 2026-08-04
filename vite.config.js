import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // During local dev (npm run dev + func start in /api), forward API calls
      "/api": "http://localhost:7071",
    },
  },
});
