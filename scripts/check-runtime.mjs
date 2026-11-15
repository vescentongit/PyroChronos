import { validateRuntime } from "../src/lib/research-deployment.ts";
const result = validateRuntime(process.env, process.argv[2] || "app");
console.log(JSON.stringify(result));
process.exitCode = result.ok ? 0 : 1;
