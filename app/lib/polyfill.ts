// Anchor expects a global Buffer in the browser.
import { Buffer } from "buffer";
import { enablePollingConfirmation } from "./confirm";
import { IS_LOCAL } from "./config";

if (typeof globalThis !== "undefined" && !globalThis.Buffer) globalThis.Buffer = Buffer;

// Off localnet the RPC may not serve websockets: confirm transactions by polling.
if (!IS_LOCAL) enablePollingConfirmation();
