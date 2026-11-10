import fs from "fs";
import path from "path";

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?|json|css|html)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk("src").concat(["index.html"].filter((f) => fs.existsSync(f)));
let n = 0;
for (const f of files) {
  let t = fs.readFileSync(f, "utf8");
  const fixed = t.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16))
  );
  if (fixed !== t) {
    fs.writeFileSync(f, fixed, "utf8");
    console.log("fixed", f);
    n++;
  }
}
console.log(n ? `Fixed ${n} file(s)` : "All files OK (no literal \\u escapes)");
