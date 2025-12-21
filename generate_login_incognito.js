// generate_login_incognito.js

// ✔ Headful, Temp Profile, Login
// ✔ Handles "I understand" (Twice)
// ✔ Handles "Agree & get started" button
// ✔ Round Robin Monitoring
// ✔ Retry if > 140s (Max 3)
// ✔ Fails immediately if "ucs-banned-answer" error is detected
// ✔ Continuously clicks "Continue/Action" button if it appears during generation
// ✔ REVISED: Force Click (JS) on XPath fallback

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

// ========= ARG PARSE =========
const argMap = {};
for (const a of process.argv.slice(2)) {
  const [k, v] = a.split("=");
  if (k && typeof v !== "undefined") {
    argMap[k.replace(/^--/, "")] = v;
  }
}

// ========= CONFIG =========
const GEMINI_URL = "https://business.gemini.google/";
const BLOB_PREFIX = "blob:https://business.gemini.google/";
const EMAIL =
  argMap.email || process.env.GEMINI_EMAIL || "1swzro22_354@latterlavender.cfd";
const PASSWORD = argMap.password || process.env.GEMINI_PASSWORD || "Haris123@";
const PROMPT_FILE = argMap.promptFile || process.env.PROMPT_FILE;

if (!PROMPT_FILE) {
  console.error("❌ No promptFile provided.");
  process.exit(1);
}

const OUTPUT_DIR =
  argMap.outputDir || process.env.OUTPUT_DIR || path.join(process.cwd(), "output");

const JOB_META_PATH = argMap.jobMeta || process.env.JOB_META_PATH || null;

let maxTabs = parseInt(argMap.maxTabs || process.env.MAX_TABS || "1", 10);
if (isNaN(maxTabs) || maxTabs <= 0) maxTabs = 1;
if (maxTabs > 40) maxTabs = 40;

const HEADLESS =
  (argMap.headless || process.env.HEADLESS || "true").toLowerCase() === "true";

const BROWSER_PATH = argMap.browserPath || process.env.BROWSER_PATH || null;

// ========= HELPERS =========
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeRandomFileName(sceneNumber) {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now();
  return `scene_${sceneNumber}_${ts}_${rand}.mp4`;
}

function updateJobMeta(status, extra = {}) {
  if (!JOB_META_PATH) return;
  try {
    let meta = {};
    if (fs.existsSync(JOB_META_PATH)) {
      const raw = fs.readFileSync(JOB_META_PATH, "utf-8");
      meta = JSON.parse(raw);
    }
    meta.status = status;
    meta.finished_at = new Date().toISOString();
    Object.assign(meta, extra);
    fs.writeFileSync(JOB_META_PATH, JSON.stringify(meta, null, 2));
    console.log("Updated job meta status to:", status);
  } catch (err) {
    console.error("Failed to update job meta:", err);
  }
}

function loadPromptsFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`Prompt file not found: ${filePath}`);
    return [];
  }
  const data = fs.readFileSync(filePath, "utf-8");
  const prompts = data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  console.log(`Loaded ${prompts.length} prompts from ${filePath}`);
  return prompts;
}

// ========= LOGIN =========
async function isElementPresent(page, selector, timeout = 5000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch (_) {
    return false;
  }
}

async function dismissWelcomeIfPresent(page) {
  const clickLaterScript = () => {
    function clickWelcomeLater() {
      const app = document.querySelector("ucs-standalone-app");
      if (!app || !app.shadowRoot) return false;
      const welcome = app.shadowRoot.querySelector("ucs-welcome-dialog");
      if (!welcome || !welcome.shadowRoot) return false;
      const dlg = welcome.shadowRoot.querySelector("md-dialog");
      if (!dlg) return false;
      const mdButtons = dlg.querySelectorAll("md-text-button");
      for (const mdBtn of mdButtons) {
        let label = "";
        if (mdBtn.shadowRoot) {
          const innerBtn = mdBtn.shadowRoot.querySelector("button");
          if (innerBtn) label = innerBtn.innerText.trim();
        }
        if (!label) label = mdBtn.innerText.trim();
        if (label.includes("I'll do this later")) {
          let target = null;
          if (mdBtn.shadowRoot) {
            target = mdBtn.shadowRoot.querySelector("button") || mdBtn;
          } else {
            target = mdBtn;
          }
          if (target) {
            target.click();
            return true;
          }
        }
      }
      return false;
    }
    return clickWelcomeLater();
  };

  try {
    const laterClicked = await page.evaluate(clickLaterScript);
    console.log("Clicked 'I'll do this later' dialog button:", laterClicked);
    await sleep(4000);
  } catch (e) {
    console.log("Welcome dialog dismiss error (ignored):", e.message);
  }
}

async function ensureLoggedInOnFirstTab(page) {
  console.log("Opening Gemini login page on first tab...");
  await page.goto(GEMINI_URL, { waitUntil: "networkidle2" });
  await sleep(3000);

  if (await isElementPresent(page, "#email-input", 8000)) {
    console.log("Login required: entering email...");

    let loginSuccess = false;
    let attempt = 0;
    const maxAttempts = 10; 

    // === LOGIN LOOP ===
    while (!loginSuccess && attempt < maxAttempts) {
      attempt++;
      console.log(`\n🔄 Login Process Attempt: ${attempt}`);

      try {
        // 1. Enter Email
        const emailInput = await page.waitForSelector("#email-input", { timeout: 10000 });
        await emailInput.click();
        await page.evaluate((el) => (el.value = ""), emailInput);
        await emailInput.type(EMAIL);
        console.log("Email entered!");

        // 2. Click Continue
        const continueBtn = await page.waitForSelector("#log-in-button", { timeout: 10000 });
        await continueBtn.click();
        console.log("Continue clicked. Waiting 8s...");
        
        // 3. Wait 8 Seconds
        await sleep(8000);

        // 4. Check for identifierId
        try {
          const idInput = await page.waitForSelector("#identifierId", { timeout: 5000 });
          await idInput.press("Enter");
          console.log("✅ identifierId Found & Next pressed!");
          loginSuccess = true; 
        } catch (idErr) {
          console.log("⚠️ identifierId NOT found.");

          if (attempt < maxAttempts) {
             console.log("⚠️ Triggering Force Click on Fallback XPath (3 attempts)...");
            
            // 5. Force Click Fallback Button (Full XPath)
            const xpath = "/html/body/c-wiz/div/div/div/div/div/div/div/div/div/div/div/button";
            let buttonClicked = false;

            for (let i = 1; i <= 3; i++) {
                try {
                    // Wait specifically for the xpath to be present
                    const buttonHandle = await page.waitForXPath(xpath, { timeout: 3000 });
                    
                    if (buttonHandle) {
                        // FORCE CLICK using Evaluate (Native JS click)
                        await page.evaluate(el => el.click(), buttonHandle);
                        console.log(`✅ Fallback button FORCE CLICKED (Attempt ${i}).`);
                        buttonClicked = true;
                        break;
                    } else {
                        console.log(`❌ XPath element handle is null (Attempt ${i}).`);
                    }
                } catch (xErr) {
                    console.log(`❌ XPath not found or not clickable (Attempt ${i}):`, xErr.message);
                }

                if (!buttonClicked && i < 3) {
                    console.log("Waiting 5s before retrying button click...");
                    await sleep(5000);
                }
            }

            // 6. Wait 8 Seconds before restarting the main login loop
            console.log("Waiting 8s before retrying email entry...");
            await sleep(8000);
          }
        }
      } catch (err) {
        console.log(`Login cycle error (Attempt ${attempt}):`, err.message);
        await sleep(3000);
      }
    }
    // === END LOGIN LOOP ===

    if (!loginSuccess) {
        console.error("❌ Failed to pass email stage after multiple attempts.");
    }

    await sleep(4000);
    try {
      const passInput = await page.waitForSelector('input[name="Passwd"]', {
        timeout: 15000,
      });
      await passInput.click();
      await passInput.type(PASSWORD);
      console.log("Password entered!");
      await passInput.press("Enter");
    } catch {
      console.log("Password field not found, maybe manual login needed or already processed!");
    }

    console.log("Checking for confirmation screens...");
    await sleep(5000);

    // === 1. First Attempt: "I understand" ===
    try {
      const confirmSelector = 'input[value="I understand"], #confirm';
      if (await isElementPresent(page, confirmSelector, 5000)) {
        console.log("⚠️ 'I understand' confirmation detected (1st time). Clicking...");
        await page.click(confirmSelector);
        await sleep(7000);
      }
    } catch (err) {
      console.log("Confirm check 1 (ignored):", err.message);
    }

    // === 2. Second Attempt: "I understand" (if it appears again) ===
    try {
      const confirmSelector = 'input[value="I understand"], #confirm';
      if (await isElementPresent(page, confirmSelector, 5000)) {
        console.log("⚠️ 'I understand' confirmation detected AGAIN. Clicking...");
        await page.click(confirmSelector);
        await sleep(5000);
      }
    } catch (err) {
      console.log("Confirm check 2 (ignored):", err.message);
    }

    // === 3. "Agree & get started" Button Check ===
    try {
      console.log("🔎 Checking for 'Agree & get started' button...");
      // Strategy A: By class (safer)
      const agreeBtnClass = ".agree-button";
      const isPresent = await isElementPresent(page, agreeBtnClass, 10000);
      if (isPresent) {
        console.log("⚠️ Found 'Agree & get started' via Class. Clicking...");
        await page.click(agreeBtnClass);
        await sleep(5000);
      } else {
        // Strategy B: By Text Content (Backup)
        const clickedByText = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll("button"));
          const target = buttons.find((b) =>
            b.innerText.includes("Agree & get started")
          );
          if (target) {
            target.click();
            return true;
          }
          return false;
        });

        if (clickedByText) {
          console.log("⚠️ Found 'Agree & get started' via Text. Clicked.");
          await sleep(5000);
        } else {
          console.log("ℹ️ 'Agree & get started' button not found.");
        }
      }
    } catch (err) {
      console.log("Agree button check error:", err.message);
    }

    console.log(
      "\n⚠️ If extra verification appears (2FA, phone, captcha), UI handle karega."
    );
    await sleep(20000);
  } else {
    console.log("Already logged in / email field not visible.");
    await sleep(5000);
  }

  await dismissWelcomeIfPresent(page);
  console.log("Login + welcome dialog flow finished on first tab.");
}

// ========= CHECKS (Blob & Error & Specific Button) =========

async function findBlobUrlNow(page, prefix) {
  return page.evaluate((innerPrefix) => {
    const visited = new Set();
    const blobUrls = [];
    function walk(node) {
      if (!node || visited.has(node)) return;
      visited.add(node);
      if (node.querySelectorAll) {
        const vids = node.querySelectorAll('video[src^="blob:"]');
        vids.forEach((v) => {
          if (v.src && v.src.startsWith(innerPrefix)) {
            blobUrls.push(v.src);
          }
        });
      }
      if (node.shadowRoot) {
        walk(node.shadowRoot);
      }
      if (node.childNodes && node.childNodes.length) {
        node.childNodes.forEach((child) => walk(child));
      }
    }
    walk(document);
    return blobUrls.length ? blobUrls[0] : null;
  }, prefix);
}

// Check for "ucs-banned-answer" component inside Shadow DOM
async function checkBannedError(page) {
  return page.evaluate(() => {
    const visited = new Set();
    let found = false;
    function walk(node) {
      if (found) return;
      if (!node || visited.has(node)) return;
      visited.add(node);
      if (node.tagName && node.tagName.toLowerCase() === "ucs-banned-answer") {
        found = true;
        return;
      }
      if (node.shadowRoot) {
        walk(node.shadowRoot);
      }
      if (node.childNodes && node.childNodes.length) {
        node.childNodes.forEach((child) => walk(child));
      }
    }
    walk(document);
    return found;
  });
}

// ** NEW FUNCTION **: Check for the specific md-filled-button in ucs-conversation and click it
async function checkAndClickContinueButton(page) {
  return page.evaluate(() => {
    try {
      const app = document.querySelector("ucs-standalone-app");
      if (!app || !app.shadowRoot) return false;

      // Recursive walker to find the button inside ucs-conversation
      let targetBtn = null;
      const visited = new Set();

      function walk(node) {
        if (targetBtn) return;
        if (!node || visited.has(node)) return;
        visited.add(node);

        if (node.tagName && node.tagName.toLowerCase() === "md-filled-button") {
          targetBtn = node;
          return;
        }

        if (node.shadowRoot) walk(node.shadowRoot);
        if (node.children) {
          for (const child of node.children) walk(child);
        }
      }

      walk(app.shadowRoot);

      if (targetBtn) {
        const innerBtn = targetBtn.shadowRoot
          ? targetBtn.shadowRoot.querySelector("button")
          : targetBtn.querySelector("button");

        const clickTarget = innerBtn || targetBtn;
        clickTarget.click();
        return true;
      }
    } catch (e) {
      // console.log(e);
    }
    return false;
  });
}

// ========= FLOW =========

async function openToolsAndClickGenerate(page) {
  const menuOpened = await page.evaluate(() => {
    const app = document.querySelector("ucs-standalone-app");
    if (!app || !app.shadowRoot) return false;
    const landing = app.shadowRoot.querySelector("ucs-chat-landing");
    if (!landing || !landing.shadowRoot) return false;
    const landingRoot = landing.shadowRoot;
    const hostDiv = landingRoot.querySelector("div > div > div > div:nth-child(1)");
    if (!hostDiv) return false;
    const searchBar = hostDiv.querySelector("ucs-search-bar");
    if (!searchBar || !searchBar.shadowRoot) return false;
    const sbRoot = searchBar.shadowRoot;
    const form = sbRoot.querySelector("form");
    if (!form) return false;
    const mainDiv = form.querySelector("div");
    if (!mainDiv) return false;
    const toolsRow = mainDiv.querySelector("div.tools-button-container");
    if (!toolsRow) return false;
    const tooltipWrapper = toolsRow.querySelector(".tooltip-wrapper");
    if (!tooltipWrapper) return false;
    const btn = tooltipWrapper.querySelector("button, md-icon-button, md-text-button");
    if (!btn) return false;
    btn.click();
    return true;
  });

  await sleep(2000);

  const menuClicked = await page.evaluate(() => {
    function findMenuItemsInShadows() {
      const result = [];
      const visited = new Set();
      function walk(node) {
        if (!node || visited.has(node)) return;
        visited.add(node);
        if (node.querySelectorAll) {
          const items = node.querySelectorAll("md-menu-item");
          if (items && items.length) items.forEach((it) => result.push(it));
        }
        if (node.shadowRoot) walk(node.shadowRoot);
        if (node.childNodes) node.childNodes.forEach((child) => walk(child));
      }
      walk(document);
      return result;
    }

    const items = findMenuItemsInShadows();
    if (!items.length) return false;
    const TARGET_TEXT = "Generate a video";
    for (let i = 0; i < items.length; i++) {
      const txt = (items[i].innerText || "").trim();
      if (txt.includes(TARGET_TEXT)) {
        const li = items[i].querySelector("li") || items[i];
        li.click();
        return true;
      }
    }
    const idx = 2;
    if (idx < items.length) {
      const fallback = items[idx];
      const li = fallback.querySelector("li") || fallback;
      li.click();
      return true;
    }
    return false;
  });

  await sleep(2000);
}

async function enterPromptAndSend(page, promptText) {
  const entered = await page.evaluate((text) => {
    const app = document.querySelector("ucs-standalone-app");
    if (!app || !app.shadowRoot) return false;
    const landing = app.shadowRoot.querySelector("ucs-chat-landing");
    if (!landing || !landing.shadowRoot) return false;
    const landingRoot = landing.shadowRoot;
    const hostDiv = landingRoot.querySelector("div > div > div > div:nth-child(1)");
    if (!hostDiv) return false;
    const searchBar = hostDiv.querySelector("ucs-search-bar");
    if (!searchBar || !searchBar.shadowRoot) return false;
    const sbRoot = searchBar.shadowRoot;
    const form = sbRoot.querySelector("form");
    if (!form) return false;
    const mainDiv = form.querySelector("div");
    if (!mainDiv) return false;
    const editorHost = mainDiv.querySelector("ucs-prosemirror-editor");
    if (!editorHost || !editorHost.shadowRoot) return false;
    const editorRoot = editorHost.shadowRoot;
    const p = editorRoot.querySelector("div > div > div > p");
    if (!p) return false;
    p.innerText = text;
    try {
      p.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } catch (_) {
      const evt = document.createEvent("HTMLEvents");
      evt.initEvent("input", true, true);
      p.dispatchEvent(evt);
    }
    return true;
  }, promptText);

  await sleep(2000);

  const sent = await page.evaluate(() => {
    function qShadow(root, selector) {
      if (!root) return null;
      if (root.shadowRoot) return root.shadowRoot.querySelector(selector);
      return root.querySelector(selector);
    }
    const app = document.querySelector("ucs-standalone-app");
    if (!app) return false;
    const landing = qShadow(app, "ucs-chat-landing") || app.querySelector("ucs-chat-landing");
    if (!landing) return false;
    const landingRoot = landing.shadowRoot || landing;
    const hostDiv = landingRoot.querySelector("div > div > div > div:nth-child(1)");
    if (!hostDiv) return false;
    const searchBar = hostDiv.querySelector("ucs-search-bar") || qShadow(hostDiv, "ucs-search-bar");
    if (!searchBar) return false;
    const sbRoot = searchBar.shadowRoot || searchBar;
    const form = sbRoot.querySelector("form");
    if (!form) return false;
    const iconButtons = Array.from(form.querySelectorAll("md-icon-button"));
    if (!iconButtons.length) return false;

    const target =
      iconButtons.find((el) => {
        const ar = (el.getAttribute("aria-label") || "").toLowerCase();
        const title = (el.getAttribute("title") || "").toLowerCase();
        const txt = (el.innerText || "").toLowerCase();
        return (
          ar.includes("send") ||
          ar.includes("submit") ||
          ar.includes("search") ||
          title.includes("send") ||
          title.includes("submit") ||
          title.includes("search") ||
          txt.includes("send")
        );
      }) || iconButtons[iconButtons.length - 1];

    let clickTarget = target;
    if (target.shadowRoot) {
      clickTarget =
        target.shadowRoot.querySelector("button") ||
        target.shadowRoot.querySelector("md-ripple") ||
        target;
    } else {
      clickTarget =
        target.querySelector("button") ||
        target.querySelector("md-ripple") ||
        target;
    }
    if (!clickTarget) return false;
    clickTarget.click();
    return true;
  });
}

async function downloadBlobVideo(page, blobUrl, outputFile) {
  console.log(`Downloading blob video for ${outputFile} ...`);
  const videoBase64 = await page.evaluate(async (url) => {
    const blob = await fetch(url).then((r) => r.blob());
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result;
        const base64 = res.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }, blobUrl);

  const dirName = path.dirname(outputFile);
  fs.mkdirSync(dirName, { recursive: true });
  fs.writeFileSync(outputFile, Buffer.from(videoBase64, "base64"));
  console.log(`🎉 Video saved: ${outputFile}`);
}

// ========= MAIN =========
async function main() {
  try {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const prompts = loadPromptsFromFile(PROMPT_FILE);
    if (!prompts.length) {
      console.log("No prompts loaded. Exiting.");
      updateJobMeta("failed", { reason: "no_prompts" });
      process.exit(1);
    }

    const total = prompts.length;
    console.log(`Total prompts: ${total}`);
    console.log(`Running in batches of max ${maxTabs} tabs.\n`);

    let globalIndex = 0;

    const launchOptions = {
      headless: HEADLESS,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--disable-gpu",
        "--window-size=1920,1080",
        "--start-maximized",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--ignore-certificate-errors",
        "--allow-running-insecure-content",
      ],
      defaultViewport: { width: 1920, height: 1080 },
    };

    if (BROWSER_PATH) launchOptions.executablePath = BROWSER_PATH;

    console.log("Launching browser with options:", launchOptions);
    const browser = await puppeteer.launch(launchOptions);

    try {
      for (let start = 0; start < total; start += maxTabs) {
        const batchPrompts = prompts.slice(start, start + maxTabs);
        const batchNumber = Math.floor(start / maxTabs) + 1;
        console.log(
          `\n========= BATCH ${batchNumber} | Prompts ${start + 1} to ${
            start + batchPrompts.length
          } =========`
        );

        const pages = [];
        for (let i = 0; i < batchPrompts.length; i++) {
          const page = await browser.newPage();
          pages.push(page);
        }

        const firstPage = pages[0];
        if (firstPage) {
          console.log("⚡ Switching focus to the login tab...");
          await firstPage.bringToFront();
        }

        await ensureLoggedInOnFirstTab(firstPage);

        console.log("Reloading all tabs to Gemini after login...");
        await Promise.all(
          pages.map((p) => p.goto(GEMINI_URL, { waitUntil: "networkidle2" }))
        );
        await sleep(5000);

        const batchJobs = pages.map((page, idx) => ({
          page,
          prompt: batchPrompts[idx],
          sceneNumber: globalIndex + 1 + idx,
          finished: false,
          startTime: null,
          retryCount: 0,
        }));
        globalIndex += batchPrompts.length;

        console.log("🚀 Submitting prompts to all tabs...");
        await Promise.all(
          batchJobs.map(async (job) => {
            console.log(` [Scene ${job.sceneNumber}] Submitting...`);
            try {
              await openToolsAndClickGenerate(job.page);
              await enterPromptAndSend(job.page, job.prompt);
              job.startTime = Date.now();
              console.log(` [Scene ${job.sceneNumber}] Submitted.`);
            } catch (e) {
              console.error(
                ` [Scene ${job.sceneNumber}] Submit Failed:`,
                e.message
              );
              job.startTime = Date.now();
            }
          })
        );

        console.log("\n✅ All prompts submitted. Monitoring...");

        const batchTimeout = Date.now() + 600 * 1000;
        while (batchJobs.some((j) => !j.finished)) {
          if (Date.now() > batchTimeout) {
            console.log("⚠️ Batch timeout reached (10 mins). Moving on.");
            break;
          }

          let pendingCount = 0;
          for (const job of batchJobs) {
            if (job.finished) continue;
            pendingCount++;

            try {
              await job.page.bringToFront();

              const btnClicked = await checkAndClickContinueButton(job.page);
              if (btnClicked) {
                console.log(
                  `🖱️ Scene ${job.sceneNumber}: Clicked 'Continue/Action' button.`
                );
                await sleep(2000);
              }

              // 1. CHECK FOR BLOB
              const blobUrl = await findBlobUrlNow(job.page, BLOB_PREFIX);
              if (blobUrl) {
                const durationSeconds = (
                  (Date.now() - job.startTime) /
                  1000
                ).toFixed(1);
                console.log(
                  `🎉 FOUND Blob for Scene ${job.sceneNumber}: ${blobUrl}`
                );
                console.log(`⏱️ Time taken: ${durationSeconds} seconds`);

                const fileName = makeRandomFileName(job.sceneNumber);
                const outputFile = path.join(OUTPUT_DIR, fileName);
                await downloadBlobVideo(job.page, blobUrl, outputFile);
                job.finished = true;
                continue;
              }

              // 2. CHECK FOR BANNED ANSWER ERROR
              const isBanned = await checkBannedError(job.page);
              if (isBanned) {
                console.log(
                  `❌ Scene ${job.sceneNumber} FAILED: 'ucs-banned-answer' detected.`
                );
                job.finished = true;
                continue;
              }

              // 3. CHECK TIMEOUT & RETRY
              const elapsed = Date.now() - job.startTime;
              const TIMEOUT_MS = 140000; // 140 sec
              if (elapsed > TIMEOUT_MS) {
                if (job.retryCount < 3) {
                  console.log(
                    `🔄 Scene ${job.sceneNumber} timed out (>140s). Retrying (${
                      job.retryCount + 1
                    }/3)...`
                  );
                  try {
                    await job.page.goto(GEMINI_URL, {
                      waitUntil: "networkidle2",
                    });
                    await sleep(3000);
                    await openToolsAndClickGenerate(job.page);
                    await enterPromptAndSend(job.page, job.prompt);
                    job.startTime = Date.now();
                    job.retryCount++;
                    console.log(` [Scene ${job.sceneNumber}] Retry submitted.`);
                  } catch (retryErr) {
                    console.error(
                      `❌ Retry failed for Scene ${job.sceneNumber}:`,
                      retryErr.message
                    );
                    job.retryCount++;
                    job.startTime = Date.now();
                  }
                } else {
                  console.log(
                    `⏳ Scene ${job.sceneNumber}: Timed out & Max retries reached.`
                  );
                }
              } else {
                console.log(
                  `⏳ Scene ${job.sceneNumber}: Generating... (${(
                    elapsed / 1000
                  ).toFixed(0)}s)`
                );
              }
            } catch (err) {
              console.log(
                `Error checking Scene ${job.sceneNumber}:`,
                err.message
              );
            }
            if (!job.finished) await sleep(5000);
          }
          if (pendingCount === 0) break;
        }

        console.log(`=== Batch ${batchNumber} completed ===`);
        for (const p of pages) {
          try {
            await p.close();
          } catch (_) {}
        }
      }

      console.log("\n✅ All batches completed.");
      updateJobMeta("completed", { total_scenes: globalIndex });
      await browser.close();
      process.exit(0);
    } catch (err) {
      console.error("Error during batches:", err);
      updateJobMeta("failed", { error: String(err) });
      await browser.close();
      process.exit(1);
    }
  } catch (err) {
    console.error("Fatal error:", err);
    updateJobMeta("failed", { error: String(err) });
    process.exit(1);
  }
}

main();
