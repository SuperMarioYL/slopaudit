import json, pathlib, subprocess, tempfile
before = """export function add(a, b) {
  return a + b;
  console.log('unreachable');
}
"""
after = """export function add(a, b) {
  return a + b;
}
"""
with tempfile.TemporaryDirectory(prefix="slopaudit-demo-") as folder:
    path = pathlib.Path(folder) / "add.js"
    for label, code in [("before", before), ("after", after)]:
        path.write_text(code)
        result = subprocess.run(["node", "dist/cli.js", folder, "--json", "--fail-on", "1"], text=True, capture_output=True)
        score = json.loads(result.stdout)
        print(json.dumps({"state":label, "score":score["score"], "band":score["band"], "files":score["filesScanned"], "findings":[{"line":f["line"],"category":f["category"],"evidence":f["evidence"]} for f in score["findings"]], "exit_code":result.returncode}, indent=2))
        assert result.returncode == (1 if label == "before" else 0), result.stderr
