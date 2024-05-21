import fs from "fs";
import path from "path";
import { exec } from "child_process";
import puppeteer, { Browser } from "puppeteer";

var browser: Browser | undefined = undefined;
const FATTURE_DIR = process.argv[2];
const OUTPUT_DIR = process.argv[3] || "./";
const TEMPLATES = {
  assoSoftware: "templates/FoglioStileAssoSoftware.xsl",
};

async function main() {
  if (!FATTURE_DIR) {
    console.log("Usage:");
    console.log("node index.js <path to xml file or directory> <output path>");
    return;
  }
  let isTempExists = false;
  try {
    isTempExists = (await fs.promises.lstat("./temp")).isDirectory();
  } catch (err) {}

  if (!isTempExists) await fs.promises.mkdir("./temp");

  await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });

  const isFile = (await fs.promises.lstat(FATTURE_DIR)).isFile();

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
    await fs.promises.rm("./temp", {
      force: true,
      recursive: true,
    });
  } else {
    for (const tempFile of htmlTempFiles) {
      await fs.promises.unlink(tempFile);
    }
  }
}

main();

async function readDirectory(dirPath: string, recursive: boolean = false) {
  let files: string[] = [];
  const data = await fs.promises.readdir(dirPath, {
    recursive: recursive,
  });
  for (const f of data) {
    const filePath = path.join(dirPath, f);
    if ((await fs.promises.stat(filePath)).isFile()) {
      files.push(filePath.replaceAll("\\", "/"));
    }
  }
  return files;
}

async function execPromise(commandLine: string) {
  return new Promise<boolean>((resolve, reject) => {
    exec(commandLine, async (err, stdout, stderr) => {
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

async function toPdf(file: string, output: string) {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: "new",
    });
  }
  const page = await browser.newPage();
  await page.goto(`file://${path.resolve(file)}`);
  await page.pdf({
    format: "A4",
    path: output,
    margin: {
      bottom: 25,
      left: 25,
      right: 25,
      top: 25,
    },
  });
  await page.close();
  return true;
}

async function convertXmlToHtml(inputPaths: string[]) {
  const tempArray = [];
  let totalFiles = inputPaths.length;
  let current = 1;
  for (const file of inputPaths) {
    const n = path.parse(file);
    const isSignedFile = n.ext.toLowerCase() === ".p7m";

    try {
      // smime
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

      // apply assosoftware stylesheet
      await execPromise(
        `java -jar SaxonHE12-3J/saxon-he-12.3.jar ${
          !isSignedFile ? file : `temp/${n.name}.xml`
        } ${TEMPLATES.assoSoftware} -o:temp/${n.name}.html`
      );
      tempArray.push(`temp/${n.name}.html`);
      if (isSignedFile) {
        await fs.promises.unlink(`temp/${n.name}.xml`);
      }
      console.log(`Converting ${current} of ${totalFiles}`);
      current++;
    } catch (e) {
      console.error(e, file);
    }
  }
  return tempArray;
}

async function sortByDate(htmlFilePaths: string[]) {
  const regex = /class="data">(\d\d-\d\d-\d\d\d\d)</g;
  let filesDatesArr: { path: string; date: number }[] = [];
  for (const file of htmlFilePaths) {
    const content = await fs.promises.readFile(file, "utf-8");
    const capure = regex.exec(content);
    if (capure) {
      const date = capure[1].split("-");
      const d = date[0];
      const m = date[1];
      const y = date[2];
      filesDatesArr.push({
        date: parseInt(y + m + d),
        path: file,
      });
    } else {
      filesDatesArr.push({
        date: Infinity,
        path: file,
      });
    }
  }
  return filesDatesArr
    .sort((a, b) => (a.date > b.date ? 1 : -1))
    .map((entry) => entry.path);
}
