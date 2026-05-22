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

const defaultRoot = 'http://127.0.0.1:8001/';
const endpoint = 'read/edits';
const authToken = 'test123'

// fetchEvents("twprice@ncsu.edu", "hw2/hw2.py").then(events => {
//     const result = PS2.createEditList(events as any, { newLineMode: PS2.NewlineMode.AutoDetect });
//     const simplifiedResult = {
//         ...result,
//         errors: result.errors.map(simplifyError)
//     };
// })
// .then((json) => {
//     console.log(Array.isArray(json) ? json.length : "Not an array");
// })
// .catch(e => {
//     console.log(JSON.stringify({
//         error: "Failed to fetch events",
//         details: e instanceof Error ? e.message : String(e)
//     }));
// });

// import { parseArgs } from 'node:util';
import { MainTableEvent } from "../progsnap/PS2EventTypes";

// const options = {
//   mode: { type: 'string' as const, short: 'm', 'default': 'fetch', choices: ['fetch', 'input'] as const },
// };

// const { values } = parseArgs({ options, allowPositionals: false });

// if (['fetch', 'input'].indexOf(values.mode) === -1) {
//     console.log(JSON.stringify({
//         error: "Invalid mode specified",
//         details: "Mode must be either 'fetch' or 'input'"
//     }));
//     process.exit(1);
// }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on("line", async line => {
    try {
        const input = JSON.parse(line);
        let events : MainTableEvent[];
        if (input && typeof input === 'object' && !Array.isArray(input) && 'SubjectID' in input && 'CodestateSection' in input) {
            if (typeof input.SubjectID !== 'string' || typeof input.CodestateSection !== 'string') {
                throw new Error("Input must contain 'SubjectID' and 'CodestateSection' string properties");
            }
            events = await fetchEvents(input.SubjectID, input.CodestateSection, input.EndTimestamp) as unknown as MainTableEvent[];
        } else if (Array.isArray(input)) {
            events = input as unknown as MainTableEvent[];
        } else {
            throw new Error("Input must be either an array of events or an object with 'SubjectID' and 'CodestateSection' properties");
        }
        const result = PS2.createEditList(events, { newLineMode: PS2.NewlineMode.AutoDetect });
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

async function fetchEvents(subjectID: string, codestateSection: string, endTimestamp: string): Promise<object> {
    let url = `${defaultRoot}${endpoint}?subject_id=${subjectID}&codestate_section=${codestateSection}`
    if (endTimestamp) {
        url += `&end_timestamp=${endTimestamp}`;
    }
    // console.log(`Fetching events from: ${url}`);
    return fetch(url, {
        method: 'GET',
        headers: {
            'X-API-Key': `${authToken}`
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Network response was not ok: ${response.statusText}`);
        }
        return response.json();
    });
}