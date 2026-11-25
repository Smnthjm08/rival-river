// The MagicBlock SDK and Anchor use the Node `Buffer` global; browsers don't
// have it. Imported first by index.ts, so it runs before those modules load.
import { Buffer } from "buffer";
if (typeof globalThis.Buffer === "undefined") globalThis.Buffer = Buffer;
