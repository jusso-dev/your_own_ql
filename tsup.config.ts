import { defineConfig, type Options } from "tsup";

const shared: Options = {
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: ["next", "react", "react-dom"],
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: "src/index.ts",
      next: "src/next/index.ts",
    },
    clean: true,
  },
  {
    ...shared,
    entry: {
      react: "src/react/index.tsx",
    },
    clean: false,
  },
]);
