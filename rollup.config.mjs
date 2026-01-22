import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const external = (id) => {
  if (id.includes("src/")) return false;

  return (
    id.startsWith("@opentelemetry/") ||
    id === "@dagger.io/telemetry" ||
    id.includes("vitest/")
  );
};

const indexConfig = {
  input: "src/index.ts",
  plugins: [
    typescript({
      tsconfig: "./tsconfig.json",
      declaration: false,
      declarationMap: false,
    }),
    json(),
    resolve({ preferBuiltins: true }),
    commonjs(),
  ],
  external,
  output: [
    {
      file: "dist/cjs/index.cjs",
      format: "cjs",
      sourcemap: true,
    },
    {
      file: "dist/esm/index.mjs",
      format: "es",
      sourcemap: true,
    },
  ],
};

export default [indexConfig];
