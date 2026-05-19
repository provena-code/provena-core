import readline from "readline";
import { PS2 } from "../index";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on("line", line => {
    try {
        const rows = JSON.parse(line);
        const result = PS2.createEditList(rows);
        console.log(JSON.stringify(result)); // flushes result as one line
    } catch (e) {
        console.error(JSON.stringify({
            error: "Failed to build edit list",
            details: e instanceof Error ? e.message : String(e)
        }));
        return;
    }
});


