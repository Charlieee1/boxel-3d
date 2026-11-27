// Manual browser-console determinism recorder - paste into devtools, then play normally.
// 1. Enable Deterministic Mode in Settings first (this script does NOT force it).
// 2. Paste this script - it starts watching immediately, no driving of its own.
// 3. Enter the level, let it sit ~10s with no input, exit (E) + re-enter, ~10s, restart (R), ~10s,
//    restart (R) again, ~10s. No player input during any phase - physics only.
// 4. Auto-downloads after 4 attempts x 600 ticks: run finishRecording() to stop/download early.
// Buckets ticks by window.__detAttempt (the game's own reset counter, bumped by Level.resetLevel()
// on every level entry/restart) - so it doesn't need to know which action you took, just that one happened.

(function () {
  const TICKS_PER_ATTEMPT = 180;
  const MAX_ATTEMPTS = 4;
  const EPSILON = 1e-9;

  window.__detAttempt = null; // fresh bucket 0 starts at your next level entry

  const attempts = [];
  let seenAttemptIndex = null;
  let finished = false;

  function nonStaticObjects() {
    return app.level.children.filter((c) => c.body != null && c.isStatic() === false);
  }

  function bodyLabel(child, index) {
    const origin = child.positionOrigin || child.position;
    const cls = child.getClass ? child.getClass() : 'unknown';
    return index + ':' + cls + '@' + Math.round(origin.x) + ',' + Math.round(origin.y);
  }

  function onEngineUpdated() {
    if (finished) return;
    const detAttempt = window.__detAttempt == null ? 0 : window.__detAttempt;

    if (detAttempt !== seenAttemptIndex) {
      seenAttemptIndex = detAttempt;
      if (attempts.length < MAX_ATTEMPTS) {
        const objects = nonStaticObjects();
        attempts.push({ attempt: detAttempt, objects, ids: objects.map(bodyLabel), frames: [], done: false });
        console.log('[determinism] attempt ' + attempts.length + '/' + MAX_ATTEMPTS + ' started (game reset #' + detAttempt + ')');
      }
    }

    const current = attempts[attempts.length - 1];
    if (current == null || current.done) return;

    current.frames.push(current.objects.map((child, i) => ({
      id: current.ids[i],
      position: { x: child.body.position.x, y: child.body.position.y },
      rotation: { z: child.body.angle },
      scale: { x: child.scale.x, y: child.scale.y, z: child.scale.z }
    })));

    if (current.frames.length >= TICKS_PER_ATTEMPT) {
      current.done = true;
      console.log('[determinism] attempt ' + attempts.length + '/' + MAX_ATTEMPTS + ' reached ' + TICKS_PER_ATTEMPT + ' ticks');
      if (attempts.length >= MAX_ATTEMPTS) finishRecording();
    }
  }

  const COMPARE_FIELDS = [
    ['position', 'x'], ['position', 'y'],
    ['rotation', 'z'],
    ['scale', 'x'], ['scale', 'y'], ['scale', 'z']
  ];

  function compareAttempts(base, other) {
    const maxAbsDiff = { position: { x: 0, y: 0 }, rotation: { z: 0 }, scale: { x: 0, y: 0, z: 0 } };
    let firstDivergence = null;
    const tickCount = Math.min(base.frames.length, other.frames.length);
    for (let t = 0; t < tickCount; t++) {
      const baseBodies = base.frames[t];
      const otherBodies = other.frames[t];
      const bodyCount = Math.min(baseBodies.length, otherBodies.length);
      for (let i = 0; i < bodyCount; i++) {
        for (const [outer, inner] of COMPARE_FIELDS) {
          const baseValue = baseBodies[i][outer][inner];
          const otherValue = otherBodies[i][outer][inner];
          const diff = Math.abs(baseValue - otherValue);
          if (diff > maxAbsDiff[outer][inner]) maxAbsDiff[outer][inner] = diff;
          if (diff > EPSILON && firstDivergence == null) {
            firstDivergence = { tick: t, bodyId: baseBodies[i].id, field: outer + '.' + inner, baseValue, otherValue, diff };
          }
        }
      }
    }
    return { against: other.attempt, tickCount, firstDivergence, maxAbsDiff, passed: firstDivergence == null };
  }

  function downloadResult(result) {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'determinism-result-' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function finishRecording() {
    if (finished) return window.__determinismResult;
    finished = true;
    window.removeEventListener('engineUpdated', onEngineUpdated);

    const cleaned = attempts.map((a) => ({ attempt: a.attempt, ids: a.ids, frames: a.frames }));
    const base = cleaned[0];
    const comparisons = base ? cleaned.slice(1).map((a) => compareAttempts(base, a)) : [];
    const passed = comparisons.every((c) => c.passed);

    const result = {
      deterministicSetting: app.storage.getSettings().deterministic,
      generatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      attempts: cleaned,
      comparisons,
      passed
    };

    window.__determinismResult = result;
    console.log(passed ? '[determinism] PASSED' : '[determinism] FAILED');
    console.table(comparisons.map((c) => ({
      against: 'attempt ' + c.against,
      passed: c.passed,
      tick: c.firstDivergence ? c.firstDivergence.tick : null,
      body: c.firstDivergence ? c.firstDivergence.bodyId : null,
      field: c.firstDivergence ? c.firstDivergence.field : null,
      diff: c.firstDivergence ? c.firstDivergence.diff : null
    })));
    console.log('[determinism] full result at window.__determinismResult - downloading now, paste console.table output (or the file) back');
    downloadResult(result);
    return result;
  }

  window.addEventListener('engineUpdated', onEngineUpdated);
  window.finishRecording = finishRecording;
  console.log('[determinism] recording started - deterministic setting is currently ' + app.storage.getSettings().deterministic + '. Enter the level to begin attempt 1.');
})();
