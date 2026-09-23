const fs = require("fs");
const path = require("path");

const targetFile = path.join(__dirname, "..", "node_modules", "sarvamai", "dist", "cjs", "core", "websocket", "ws.js");
const searchString = "this._ws = new WebSocket(url, this._protocols, options);\n            this._ws.binaryType = this._binaryType;\n            this._connectLock = false;";
const replacementString = "this._ws = new WebSocket(url, this._protocols, options);\n            this._ws.binaryType = this._binaryType;\n            this._ws.addEventListener(\"error\", () => {});\n            this._connectLock = false;";
const alreadyPatchedString = "this._ws.addEventListener(\"error\", () => {});";

function patchSarvamWebSocket()
{
    if(!fs.existsSync(targetFile))
    {
        console.warn(`⚠️ [PatchSarvam] Target file not found, skipping: ${targetFile}`);
        return;
    }

    const fileContents = fs.readFileSync(targetFile, "utf8");

    if(fileContents.includes(alreadyPatchedString))
    {
        console.log(`✅ [PatchSarvam] Already patched, skipping.`);
        return;
    }

    if(!fileContents.includes(searchString))
    {
        console.warn(`⚠️ [PatchSarvam] Expected code block not found — sarvamai package internals may have changed. Skipping patch, please review manually.`);
        return;
    }

    const patchedContents = fileContents.replace(searchString, replacementString);

    fs.writeFileSync(targetFile, patchedContents, "utf8");
    console.log(`✅ [PatchSarvam] Patched sarvamai ReconnectingWebSocket successfully.`);
}

patchSarvamWebSocket();