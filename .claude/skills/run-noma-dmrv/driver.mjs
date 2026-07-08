#!/usr/bin/env node
/**
 * Agent driver for noma-dmrv — launches a headless Chromium (Playwright,
 * already a repo devDependency), signs in as the local admin via the
 * Better Auth HTTP API (same path as tests/e2e/fixtures/auth-fixtures.ts),
 * then executes a sequence of actions against the running dev server.
 *
 * The dev server must already be running on port 3100 (`pnpm dev`).
 *
 * Usage (run from repo root):
 *   node .claude/skills/run-noma-dmrv/driver.mjs <path> [action ...]
 *
 * Actions (executed in order after navigating to <path>):
 *   shot=<file.png>          full-page screenshot (relative paths land in $TMPDIR/noma-shots/)
 *   click=<selector>         Playwright selector, e.g. click='text=New Facility'
 *   fill=<selector>::<value> fill an input
 *   press=<key>              keyboard key, e.g. press=Escape
 *   wait=<ms|selector>       sleep N ms, or wait for a selector
 *   goto=<path>              navigate to another app path
 *   text                     print visible page text (truncated) to stdout
 *   html=<selector>          print outerHTML of first match
 *
 * Special first arg:
 *   check                    just verify server + auth, print status, exit
 *   --no-auth                (flag before <path>) skip sign-in, land on /login
 *
 * Examples:
 *   node .claude/skills/run-noma-dmrv/driver.mjs check
 *   node .claude/skills/run-noma-dmrv/driver.mjs /facilities shot=facilities.png
 *   node .claude/skills/run-noma-dmrv/driver.mjs /facilities click='text=New Facility' wait=500 shot=sheet.png
 */
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100";
const SHOT_DIR = join(tmpdir(), "noma-shots");
const TEXT_LIMIT = 4000;

function loadEnvLocal() {
  // Minimal .env.local parser — only need ADMIN_EMAIL / ADMIN_PASSWORD.
  const env = {};
  try {
    for (const line of readFileSync(resolve(".env.local"), "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* missing .env.local handled by caller */
  }
  return env;
}

async function checkServer() {
  try {
    const res = await fetch(`${BASE_URL}/login`, { redirect: "manual" });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function signIn(env) {
  const email = env.ADMIN_EMAIL;
  const password = env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("ADMIN_EMAIL / ADMIN_PASSWORD not found in .env.local — run `pnpm env:local` first");
  }
  const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE_URL },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  }
  // Collect session cookies from set-cookie headers.
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const url = new URL(BASE_URL);
  const cookies = setCookies.map((c) => {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    return {
      name: pair.slice(0, eq).trim(),
      value: pair.slice(eq + 1).trim(),
      domain: url.hostname,
      path: "/",
    };
  });
  if (!cookies.length) throw new Error("sign-in returned no session cookie");
  return cookies;
}

function shotPath(file) {
  if (isAbsolute(file)) return file;
  mkdirSync(SHOT_DIR, { recursive: true });
  return join(SHOT_DIR, file);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error("usage: driver.mjs check | [--no-auth] <path> [action ...]  (see file header)");
    process.exit(2);
  }

  if (!(await checkServer())) {
    console.error(`FAIL: no dev server at ${BASE_URL} — start it with \`pnpm dev\` (background) first`);
    process.exit(1);
  }

  const env = loadEnvLocal();

  if (args[0] === "check") {
    const cookies = await signIn(env);
    console.log(`OK: server up at ${BASE_URL}, admin sign-in OK (${cookies.length} cookie(s))`);
    return;
  }

  const noAuth = args[0] === "--no-auth";
  if (noAuth) args.shift();
  const startPath = args.shift();
  const actions = args;

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (!noAuth) await context.addCookies(await signIn(env));
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  try {
    await page.goto(`${BASE_URL}${startPath}`, { waitUntil: "networkidle" });
    console.log(`at ${page.url()}`);

    for (const action of actions) {
      const eq = action.indexOf("=");
      const cmd = eq === -1 ? action : action.slice(0, eq);
      const arg = eq === -1 ? "" : action.slice(eq + 1);

      if (cmd === "shot") {
        const out = shotPath(arg || "shot.png");
        await page.screenshot({ path: out, fullPage: true });
        console.log(`shot -> ${out}`);
      } else if (cmd === "click") {
        await page.locator(arg).first().click();
        console.log(`clicked ${arg}`);
      } else if (cmd === "fill") {
        const [sel, value] = arg.split("::");
        await page.locator(sel).first().fill(value ?? "");
        console.log(`filled ${sel}`);
      } else if (cmd === "press") {
        await page.keyboard.press(arg);
        console.log(`pressed ${arg}`);
      } else if (cmd === "wait") {
        if (/^\d+$/.test(arg)) await page.waitForTimeout(Number(arg));
        else await page.locator(arg).first().waitFor();
        console.log(`waited ${arg}`);
      } else if (cmd === "goto") {
        await page.goto(`${BASE_URL}${arg}`, { waitUntil: "networkidle" });
        console.log(`at ${page.url()}`);
      } else if (cmd === "text") {
        const text = await page.locator("body").innerText();
        console.log(text.slice(0, TEXT_LIMIT));
      } else if (cmd === "html") {
        const html = await page.locator(arg).first().evaluate((el) => el.outerHTML);
        console.log(html.slice(0, TEXT_LIMIT));
      } else {
        console.error(`unknown action: ${action}`);
        process.exitCode = 2;
        break;
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
