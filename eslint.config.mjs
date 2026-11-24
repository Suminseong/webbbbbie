import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/test-results/**", "**/playwright-report/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["packages/engine/src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        "Date",
        "performance",
        "window",
        "document",
        "process",
        "fetch",
        "localStorage",
        "indexedDB",
        "crypto",
      ],
      "no-restricted-properties": [
        "error",
        ...["random", "pow", "exp", "log", "sin", "cos", "tan"].map(
          (property) => ({
            object: "Math",
            property,
            message:
              "Keep the simulation reproducible across Node and browser runtimes.",
          }),
        ),
      ],
    },
  },
);
