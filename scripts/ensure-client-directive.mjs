import { readFile, writeFile } from "node:fs/promises";

const directive = '"use client";\n';
const files = ["dist/react.js", "dist/react.cjs"];

for (const file of files) {
  const current = await readFile(file, "utf8");
  const withoutExistingDirective = current.replace(
    /^(['"])use client\1;?\s*/,
    "",
  );

  await writeFile(file, `${directive}${withoutExistingDirective}`);
}
