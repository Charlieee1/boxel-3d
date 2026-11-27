#!/usr/bin/env node
// Automated determinism test: node tools/determinism-test.js --file="level.json" [--output=result.json] [--ticks=600]
// No headless entry point exists for the game, so this drives a real headless browser instead.
// Records position/rotation/scale of every nonstatic object across 4 attempts, compares them.
// Exits 0 if all attempts matched, 1 otherwise.

import { chromium, firefox } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OVERALL_TIMEOUT_MS = 120000; // hard cap so a hang can never block for long

// Runs inside the browser page - must be self-contained, Playwright serializes this function.
async function browserRunDeterminismTest({ levelJSON, options }) {
  const TICKS_PER_ATTEMPT = options.ticks;
  const EPSILON = 1e-9;

  function nonStaticObjects() {
    return app.level.children.filter((c) => c.body != null && c.isStatic() === false);
  }

  function bodyLabel(child, index) {
    const origin = child.positionOrigin || child.position;
    const cls = child.getClass ? child.getClass() : 'unknown';
    return index + ':' + cls + '@' + Math.round(origin.x) + ',' + Math.round(origin.y);
  }

  function recordAttempt(label, ticks) {
    return new Promise((resolve) => {
      const objects = nonStaticObjects();
      const ids = objects.map(bodyLabel);
      const frames = [];
      const detAttempts = []; // Level.resetLevel()'s own counter - bumps on every reset, including an
      // in-run auto-death respawn (Player.kill()'s real-time setTimeout), not just this recording's own attempt boundary.
      function onEngineUpdated() {
        frames.push(objects.map((child, i) => ({
          id: ids[i],
          position: { x: child.body.position.x, y: child.body.position.y },
          rotation: { z: child.body.angle },
          scale: { x: child.scale.x, y: child.scale.y, z: child.scale.z }
        })));
        detAttempts.push(window.__detAttempt);
        if (frames.length >= ticks) {
          window.removeEventListener('engineUpdated', onEngineUpdated);
          resolve({ label, ids, frames, detAttempts });
        }
      }
      window.addEventListener('engineUpdated', onEngineUpdated);
    });
  }

  const COMPARE_FIELDS = [
    ['position', 'x'], ['position', 'y'],
    ['rotation', 'z'],
    ['scale', 'x'], ['scale', 'y'], ['scale', 'z']
  ];

  // Frame indices where detAttempts changes value - i.e. every reset within this recording, whether it's
  // this attempt's own start or a mid-run auto-death respawn that happened to fire during it.
  function segmentStarts(detAttempts) {
    const starts = [0];
    for (let t = 1; t < detAttempts.length; t++) {
      if (detAttempts[t] !== detAttempts[t - 1]) starts.push(t);
    }
    return starts;
  }

  // A wall-clock-timed reset (auto-death respawn) lands on a different absolute tick every run - that's
  // expected, not a bug, since Player.kill()'s respawn delay is a real setTimeout, not a tick count. So
  // attempts are compared segment-by-segment (a segment = the span between two resets), aligned by ticks
  // SINCE each segment's own reset rather than by raw absolute tick, matching how the game actually
  // guarantees determinism: identical state at every reset, not identical wall-clock timing between them.
  function compareAttempts(base, other) {
    const maxAbsDiff = { position: { x: 0, y: 0 }, rotation: { z: 0 }, scale: { x: 0, y: 0, z: 0 } };
    let firstDivergence = null;
    let tickCount = 0;

    const baseStarts = segmentStarts(base.detAttempts);
    const otherStarts = segmentStarts(other.detAttempts);
    const segCount = Math.min(baseStarts.length, otherStarts.length);

    for (let s = 0; s < segCount; s++) {
      const baseStart = baseStarts[s], otherStart = otherStarts[s];
      const baseEnd = s + 1 < baseStarts.length ? baseStarts[s + 1] : base.frames.length;
      const otherEnd = s + 1 < otherStarts.length ? otherStarts[s + 1] : other.frames.length;
      const segLen = Math.min(baseEnd - baseStart, otherEnd - otherStart);

      for (let k = 0; k < segLen; k++) {
        const baseBodies = base.frames[baseStart + k];
        const otherBodies = other.frames[otherStart + k];
        const bodyCount = Math.min(baseBodies.length, otherBodies.length);
        tickCount++;
        for (let i = 0; i < bodyCount; i++) {
          for (const [outer, inner] of COMPARE_FIELDS) {
            const baseValue = baseBodies[i][outer][inner];
            const otherValue = otherBodies[i][outer][inner];
            const diff = Math.abs(baseValue - otherValue);
            if (diff > maxAbsDiff[outer][inner]) maxAbsDiff[outer][inner] = diff;
            if (diff > EPSILON && firstDivergence == null) {
              firstDivergence = { segment: s, tickInSegment: k, bodyId: baseBodies[i].id, field: outer + '.' + inner, baseValue, otherValue, diff };
            }
          }
        }
      }
    }
    return { against: other.label, tickCount, firstDivergence, maxAbsDiff, passed: firstDivergence == null };
  }

  if (typeof app === 'undefined' || app.level == null) {
    throw new Error('window.app is not ready');
  }

  const settings = app.storage.getSettings();
  const originalDeterministic = settings.deterministic;
  settings.deterministic = true;
  app.updateSettings(settings);

  // Rendering never needs to run - recording only reads physics (child.body), never the render-side
  // position/alpha - so this is purely a CPU-cost cut, it doesn't change the interval/rAF loop timing.
  app.updateRender = function () {};

  // startLevel() plays a jump sound every attempt - silence it so headless runs make no sound.
  app.assets.audio.play = function () {};

  // Mirrors the real Level Editor flow (PageLevelManager.editLevel + PageLevelEditor.playCurrentLevel/
  // pauseLevel), NOT App.playLevel()/exitCampaign() - the editor never rebuilds from JSON after the
  // initial load, it only ever calls resetScene()/retryLevel() on the same live bodies. That distinction
  // matters: "initial-enter" is the first resetLevel() ever run on freshly-constructed bodies, while every
  // later attempt resets bodies that already ran a full physics pass (and may have gone to sleep, etc).
  function enterPlayMode() {
    app.player.cancelRestart();
    if (app.storage.getSettings().deterministic === true) {
      app.player.resetDeterministicPhysics();
      app.updateGravity();
    }
    app.startLevel();
  }

  const attempts = [];
  try {
    app.level.clearLevel();
    app.level.importFromJSON(levelJSON);
    app.resetScene();
    enterPlayMode();
    attempts.push(await recordAttempt('initial-enter', TICKS_PER_ATTEMPT));

    app.pauseLevel();
    app.resetScene();
    enterPlayMode();
    attempts.push(await recordAttempt('pause-reenter', TICKS_PER_ATTEMPT));

    app.level.retryLevel();
    attempts.push(await recordAttempt('restart-1', TICKS_PER_ATTEMPT));

    app.level.retryLevel();
    attempts.push(await recordAttempt('restart-2', TICKS_PER_ATTEMPT));
  } finally {
    settings.deterministic = originalDeterministic;
    app.updateSettings(settings);
  }

  const base = attempts[0];
  const comparisons = attempts.slice(1).map((attempt) => compareAttempts(base, attempt));
  const passed = comparisons.every((c) => c.passed);

  return {
    level: levelJSON.name || null,
    ticksPerAttempt: TICKS_PER_ATTEMPT,
    generatedAt: new Date().toISOString(),
    attempts,
    comparisons,
    passed
  };
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return args;
}

async function isServerUp(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

function killProcessTree(child) {
  // shell:true means child.kill() only signals the shell, not the real vite process underneath.
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else child.kill();
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerUp(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for dev server at ' + url);
}

async function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error('Usage: node tools/determinism-test.js --file="<level.json>" [--output=<result.json>] [--ticks=600]');
    process.exit(1);
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, '..');
  const devServerUrl = 'http://localhost:5173/';

  const levelJSON = JSON.parse(readFileSync(path.resolve(args.file), 'utf8'));
  const options = {
    ticks: args.ticks ? parseInt(args.ticks, 10) : 600
  };

  let devServer = null;
  const alreadyRunning = await isServerUp(devServerUrl);
  if (!alreadyRunning) {
    console.log('[determinism-test] starting a temporary vite dev server...');
    devServer = spawn('npx', ['vite', '--port', '5173', '--strictPort'], {
      cwd: repoRoot,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    devServer.stderr.on('data', (d) => process.stderr.write('[vite] ' + d));
    await waitForServer(devServerUrl, 30000);
  } else {
    console.log('[determinism-test] reusing already-running dev server at ' + devServerUrl);
  }

  // No real GPU in headless Chromium here, so force software WebGL to avoid a GPU-process crash.
  // --disable-frame-rate-limit removes Chromium's internal compositor pacing cap on requestAnimationFrame.
  const useFirefox = args.browser === 'firefox';
  const browser = useFirefox
    ? await firefox.launch({ firefoxUserPrefs: { 'media.volume_scale': '0.0' } }) // browser-level mute, belt-and-suspenders alongside the in-page audio.play() override
    : await chromium.launch({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--in-process-gpu', '--disable-frame-rate-limit', '--disable-gpu-vsync', '--mute-audio']
    });
  let result;
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
    page.on('pageerror', (err) => console.error('[browser error] ' + err));

    await page.goto(devServerUrl);
    await page.waitForFunction(() => window.app && window.app.level != null, null, { timeout: 30000 });

    result = await withTimeout(
      page.evaluate(browserRunDeterminismTest, { levelJSON, options }),
      OVERALL_TIMEOUT_MS,
      'browserRunDeterminismTest did not finish within ' + OVERALL_TIMEOUT_MS + 'ms'
    );
  } finally {
    await browser.close();
    if (devServer) killProcessTree(devServer);
  }

  if (args.output) {
    writeFileSync(path.resolve(args.output), JSON.stringify(result, null, 2));
    console.log('[determinism-test] wrote full result to ' + args.output);
  }

  console.log('[determinism-test] level: ' + result.level + ', passed: ' + result.passed);
  for (const c of result.comparisons) {
    console.log('  vs ' + c.against + ': ' + (c.passed
      ? 'MATCH'
      : 'DIVERGED at segment ' + c.firstDivergence.segment + ', tick ' + c.firstDivergence.tickInSegment + ' since that segment\'s reset, body ' + c.firstDivergence.bodyId + ', field ' + c.firstDivergence.field));
  }

  process.exit(result.passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
