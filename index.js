"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// index.ts
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var import_child_process = require("child_process");
var import_puppeteer = __toESM(require("puppeteer"));
var browser = void 0;
var FATTURE_DIR = process.argv[2];
var OUTPUT_DIR = process.argv[3] || "./";
var TEMPLATES = {
  assoSoftware: "templates/FoglioStileAssoSoftware.xsl"
};
async function main() {
  if (!FATTURE_DIR) {
    console.log("Usage:");
    console.log("node index.js <path to xml file or directory> <output path>");
    return;
  }
  let isTempExists = false;
  try {
    isTempExists = (await import_fs.default.promises.lstat("./temp")).isDirectory();
  } catch (err) {
  }
  if (!isTempExists)
    await import_fs.default.promises.mkdir("./temp");
  await import_fs.default.promises.mkdir(OUTPUT_DIR, { recursive: true });
  const isFile = (await import_fs.default.promises.lstat(FATTURE_DIR)).isFile();
  const files = isFile ? [FATTURE_DIR] : await readDirectory(FATTURE_DIR);
  const htmlTempFiles = await convertXmlToHtml(files);
  const sortedTemp = await sortByDate(htmlTempFiles);
  for (const idx in sortedTemp) {
    const file = sortedTemp[idx];
    console.log(`GENERATING PDF FOR ${file} as output/${Number(idx) + 1}.pdf`);
    await toPdf(file, `output/${Number(idx) + 1}.pdf`);
  }
  await browser?.close();
  if (!isTempExists) {
    await import_fs.default.promises.rm("./temp", {
      force: true,
      recursive: true
    });
  } else {
    for (const tempFile of htmlTempFiles) {
      await import_fs.default.promises.unlink(tempFile);
    }
  }
}
main();
async function readDirectory(dirPath, recursive = false) {
  let files = [];
  const data = await import_fs.default.promises.readdir(dirPath, {
    recursive
  });
  for (const f of data) {
    const filePath = import_path.default.join(dirPath, f);
    if ((await import_fs.default.promises.stat(filePath)).isFile()) {
      files.push(filePath.replaceAll("\\", "/"));
    }
  }
  return files;
}
async function execPromise(commandLine) {
  return new Promise((resolve, reject) => {
    (0, import_child_process.exec)(commandLine, async (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      if (stdout.length > 0) {
        resolve(true);
        return;
      }
      console.error(stderr);
      resolve(false);
    });
  });
}
async function toPdf(file, output) {
  if (!browser) {
    browser = await import_puppeteer.default.launch({
      headless: "new"
    });
  }
  const page = await browser.newPage();
  await page.goto(`file://${import_path.default.resolve(file)}`);
  await page.pdf({
    format: "A4",
    path: output,
    margin: {
      bottom: 25,
      left: 25,
      right: 25,
      top: 25
    }
  });
  await page.close();
  return true;
}
async function convertXmlToHtml(inputPaths) {
  const tempArray = [];
  let totalFiles = inputPaths.length;
  let current = 1;
  for (const file of inputPaths) {
    const n = import_path.default.parse(file);
    const isSignedFile = n.ext.toLowerCase() === ".p7m";
    try {
      if (isSignedFile) {
        let opensslResult = false;
        try {
          await execPromise(
            `openssl cms -verify -in ${file} -inform DER -noverify -out temp/${n.name}.xml`
          );
          opensslResult = true;
        } catch (e) {
          opensslResult = false;
        }
        console.log("OPENSSL VERIFICATION: ", opensslResult);
        if (!opensslResult) {
          await execPromise(
            `cat ${file} | tr -d '\\r\\n' | openssl base64 -d -A | openssl cms -verify -inform DER -noverify -out temp/${n.name}.xml`
          );
        }
      }
      await execPromise(
        `java -jar SaxonHE12-3J/saxon-he-12.3.jar ${!isSignedFile ? file : `temp/${n.name}.xml`} ${TEMPLATES.assoSoftware} -o:temp/${n.name}.html`
      );
      tempArray.push(`temp/${n.name}.html`);
      if (isSignedFile) {
        await import_fs.default.promises.unlink(`temp/${n.name}.xml`);
      }
      console.log(`Converting ${current} of ${totalFiles}`);
      current++;
    } catch (e) {
      console.error(e, file);
    }
  }
  return tempArray;
}
async function sortByDate(htmlFilePaths) {
  const regex = /class="data">(\d\d-\d\d-\d\d\d\d)</g;
  let filesDatesArr = [];
  for (const file of htmlFilePaths) {
    const content = await import_fs.default.promises.readFile(file, "utf-8");
    const capure = regex.exec(content);
    if (capure) {
      const date = capure[1].split("-");
      const d = date[0];
      const m = date[1];
      const y = date[2];
      filesDatesArr.push({
        date: parseInt(y + m + d),
        path: file
      });
    } else {
      filesDatesArr.push({
        date: Infinity,
        path: file
      });
    }
  }
  return filesDatesArr.sort((a, b) => a.date > b.date ? 1 : -1).map((entry) => entry.path);
}
