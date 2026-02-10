import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * GitHub Pages-friendly base path.
 * Using "./" makes the build work no matter what your repo name is.
 */
export default defineConfig({
  plugins: [react()],
  base: "./"
});
