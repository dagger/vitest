import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const external = (id) => {
  if (id.includes("src/")) return false;

  return (
    id.startsWith("@opentelemetry/") ||
    id === "@dagger.io/telemetry" ||
    id.includes("vitest/") ||
    id === "import-in-the-middle"
  );
};

const registerConfig = {
  input: "src/register.ts",
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
      file: "dist/cjs/register.cjs",
      format: "cjs",
      sourcemap: true,
    },
    {
      file: "dist/esm/register.mjs",
      format: "es",
      sourcemap: true,
    },
  ],
};

const hookConfig = {
  input: "src/hook.ts",
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
      file: "dist/cjs/hook.js",
      format: "cjs",
      sourcemap: true,
    },
    {
      file: "dist/esm/hook.js",
      format: "es",
      sourcemap: true,
    },
  ],
};

export default [registerConfig, hookConfig];
