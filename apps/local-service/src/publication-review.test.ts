import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("reports locations without leaking matched secret or personal text", () => {
  const code = `import { reviewText } from './scripts/prepare-publication.mjs';
    const secret = 'sk-' + 'A'.repeat(40);
    const text = secret + '\\n' + 'C:' + String.fromCharCode(92) + 'Users' + String.fromCharCode(92) + 'Synthetic' + String.fromCharCode(92) + 'file';
    const report = reviewText(text, 'fixture.txt');
    if (report.length !== 2 || report.some(x => x.severity !== 'block')) throw Error('missing blockers');
    if (JSON.stringify(report).includes(secret) || JSON.stringify(report).includes('Synthetic')) throw Error('leaked content');
    console.log('safe');`;
  expect(execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", windowsHide: true })).toContain("safe");
});
