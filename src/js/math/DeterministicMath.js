// Engine-exact Math.sin/cos/atan2/acos for deterministic mode, swapped into the global Math since matter-js calls it directly
import * as ChromeMath from './ChromeMath.js';
import * as FirefoxMath from './FirefoxMath.js';

const FUNCTIONS = ['sin', 'cos', 'atan2', 'acos'];
const NATIVE = { sin: Math.sin, cos: Math.cos, atan2: Math.atan2, acos: Math.acos };
const ENGINES = { chrome: ChromeMath, firefox: FirefoxMath };

// Inputs where Chrome (LLVM libc), Firefox (fdlibm), older V8 (fdlibm) and the Windows CRT disagree
const PROBES = {
  sin: [1.4288, 5.4823, 5.1862, 8.7219, 5.4743, -1.3893, 8.6157, 8.133, 6.8214, -3.8906, -0.7507, 3.6328].map(x => [x]),
  cos: [-8.8289, 4.3281, 0.8937, 5.4788, -5.509, 6.0024, -6.9918, 0.7654, -5.4748, 5.4737, 0.7358, 4.1571].map(x => [x]),
  atan2: [[5.728, -2.579], [-5.173, 8.944], [-5.742, -3.342], [-4.737, 7.511]],
  acos: [-0.78578, 0.32646, -0.85546, 0.30251].map(x => [x])
};
const nativeMatchCache = {};

// Fixed pseudo-random inputs on top of the known disagreements
function getProbes(name) {
  var seed = 7;
  var random = function() { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  var probes = PROBES[name].slice();
  for (var i = 0; i < 64; i++) {
    if (name == 'acos') probes.push([random() * 2 - 1]);
    else if (name == 'atan2') probes.push([(random() * 2 - 1) * 100, (random() * 2 - 1) * 100]);
    else probes.push([(random() * 2 - 1) * 100]);
  }
  return probes;
}

// True when the browser's own function gives the engine's exact results (checked by value, not user agent)
function nativeMatches(engine, name) {
  var key = engine + '.' + name;
  if (nativeMatchCache[key] == null) {
    var port = ENGINES[engine][name];
    nativeMatchCache[key] = getProbes(name).every(args => Object.is(NATIVE[name](...args), port(...args)));
  }
  return nativeMatchCache[key];
}

// Use 'chrome' or 'firefox' results (native where they already match), anything else restores the browser's Math
function setDeterministicMath(engine) {
  var ports = ENGINES[engine];
  FUNCTIONS.forEach(function(name) {
    Math[name] = (ports && !nativeMatches(engine, name)) ? ports[name] : NATIVE[name];
  });
}

export { setDeterministicMath };
