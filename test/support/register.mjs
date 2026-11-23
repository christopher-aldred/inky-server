// Lets `node --test` load the app's TypeScript, whose relative imports have no
// file extension (Next.js style): "./weather-time" -> "./weather-time.ts".
import { register } from "node:module";

register("./resolve-ts.mjs", import.meta.url);
