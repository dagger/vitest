/**
 * Register module that hooks into Vitest's test and describe functions.
 * Load this file using --import flag.
 *
 * This sets up import-in-the-middle BEFORE any modules are loaded,
 * allowing us to intercept @vitest/runner when it's imported.
 */

import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Register the import-in-the-middle hook loader
// This MUST happen before any imports of vitest/runner
register("import-in-the-middle/hook.mjs", pathToFileURL(import.meta.url));

// Now import and set up the actual hooks
// This runs in the loader context
import "./hook.ts";
