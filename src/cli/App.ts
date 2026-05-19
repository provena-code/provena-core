import readline from "readline";
import { PS2 } from "../index";

// Simplified an error so it no longer contains object references
// This avoid possible issues with circular references when we try to serialize the result to JSON
// Objects are simply converted to strings simply (not JSON stringified) to keep it minimal
function simplifyError(error: any[]): string {
    return error.map(item => {
        return String(item);
    }).join(" ");
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on("line", line => {
    try {
        const rows = JSON.parse(line);
        const result = PS2.createEditList(rows, { newLineMode: PS2.NewlineMode.AutoDetect });
        const simplifiedResult = {
            ...result,
            errors: result.errors.map(simplifyError)
        };
        console.log(JSON.stringify(simplifiedResult)); // flushes result as one line
    } catch (e) {
        console.log(JSON.stringify({
            error: "Failed to build edit list",
            details: e instanceof Error ? e.message : String(e)
        }));
        return;
    }
});


