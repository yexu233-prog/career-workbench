// Test-only subprocess. Uses fictional input and never loads a native binding.
if (process.argv[2] === "delete") {
  setInterval(() => {}, 1000);
} else {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(JSON.stringify({
    input,
    args: process.argv.slice(2),
    injectionVariables: Object.keys(process.env).filter(key => key === "NODE_OPTIONS" || key === "NODE_PATH" || key.startsWith("DYLD_"))
  }));
}
