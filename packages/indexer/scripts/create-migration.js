const fs = require("fs");
const dayjs = require("dayjs");

const moduleName = process.argv[2];
const filename = dayjs().format("YYYYMMDDHHmmss") + ".ts";
if (!moduleName || moduleName.trim() == "") {
  console.log("Must provide a module name");
  process.exit();
}
let filePath;
console.log(__dirname);
if (moduleName.trim() == "core") {
  filePath = __dirname + "/../src/db";
} else {
  filePath = __dirname + "/../src/modules/" + moduleName.trim();
}
try {
  const module_exists = fs.statSync(filePath).isDirectory();
  if (!module_exists) {
    console.log(moduleName.trim() + " is not a directory!");
    process.exit();
  }
  if (!fs.existsSync(filePath + "/migrations")) fs.mkdirSync(filePath + "/migrations");
  fs.copyFileSync(__dirname + "/../src/templates/migration-template.ts", filePath + "/migrations/" + filename);
} catch (e) {
  console.log(e);
  process.exit();
}
