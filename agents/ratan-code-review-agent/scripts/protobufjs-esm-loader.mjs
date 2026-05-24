import { readFile } from "node:fs/promises";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "protobufjs/ext/descriptor") {
    return nextResolve("protobufjs/ext/descriptor.js", context);
  }
  if (specifier === "protobufjs/minimal") {
    return nextResolve("protobufjs/minimal.js", context);
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.includes("/protobufjs/") && url.endsWith(".json")) {
    const source = await readFile(new URL(url), "utf8");
    return {
      format: "module",
      source: `export default ${source};`,
      shortCircuit: true,
    };
  }

  return nextLoad(url, context);
}
