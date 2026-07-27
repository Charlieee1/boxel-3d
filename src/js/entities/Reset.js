import { Bodies, Body } from 'matter-js';
import { Cube } from './Cube.js';

// Default reset config: matches original (pre-config) Reset block behavior
const DEFAULT_RESET_CONFIG = {
  resetSize: true,
  resetPlayerMode: true,
  resetForce: true,
  resetRotation: false, // Only Z rotation
  resetVelocity: false,
  resetAngularVelocity: false,
  resetPlayerCheckpoint: false,
  resetInfiniteJumpMode: true
};

class Reset extends Cube {
  constructor(options = {}) {
    super(options);
    this.body.class = 'reset';
    this.resetConfig = { ...DEFAULT_RESET_CONFIG };
    this.resetConfigOrigin = { ...DEFAULT_RESET_CONFIG };

    // Add sensor and parts
    this.hitbox.isSensor = true;
    this.sensor = Bodies.rectangle(0, 0, options.scaleX, options.scaleY, { isSensor: true, density: 0, class: 'sensor' });
    Body.setParts(this.body, [this.hitbox, this.sensor]);

    this.setScale({ x: 16, y: 16, z: 16 });
    this.shapes.removeAllShapes();
    this.addShapes(options);
  }

  setColors() {
    // Prevent setting colors
  }

  setResetConfig(config, updateOrigin = true) {
    this.resetConfig = { ...this.resetConfig, ...config };
    if (updateOrigin == true) this.setResetConfigOrigin(this.resetConfig);
  }

  setResetConfigOrigin(config) {
    this.resetConfigOrigin = { ...config };
  }

  getResetConfig() {
    return this.resetConfig;
  }

  resetToOrigin() {
    super.resetToOrigin();
    if (this.resetConfigOrigin) this.setResetConfig(this.resetConfigOrigin, false);
  }

  toJSON() {
    var json = super.toJSON();

    // Include resetConfig only if any value differs from the default
    var hasNonDefault = Object.keys(DEFAULT_RESET_CONFIG).some(function(key) {
      return this.resetConfig[key] !== DEFAULT_RESET_CONFIG[key];
    }.bind(this));
    if (hasNonDefault) json.resetConfig = this.resetConfig;

    return json;
  }

  addShapes(options) {
    var count = 3;
    var u = (options.scaleZ * (1 / count)); // unit size
    var start = -Math.floor(count / 2);
    var end = Math.ceil(count / 2);
    var index = 0;
    var color = '#0287ef';
    for (var z = start; z < end; z++) {
      for (var y = start; y < end; y++) {
        for (var x = start; x < end; x++) {
          if (index % 2 != 0) {
            if (z == 0 && y == 0) color = '#ffffff';
            else color = '#0287ef';
            this.shapes.addCube({ x: (u * x), y: (u * y), z: (u * z), scaleX: (u * 1), scaleY: (u * 1), scaleZ: (u * 1), color: color });
          }
          index++;
        }
      }
    }
  }
}

export { Reset };