import { isLand } from "./world.js";
import { ASCII, BLOCK_RAMP, BLOCKS, asciiToHtml, hasActiveSelection } from "./ascii.js";

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const W = 50, H = 27, S = 16, A = 1.7;
const CX = (W - 1) / 2, CY = (H - 1) / 2, K = S / A;
const RAMP = BLOCK_RAMP, NR = RAMP.length - 1;
const CAMERA_ORBIT_TILT = 18 * DEG_TO_RAD;
const EARTH_OBLIQUITY = 23.4393 * DEG_TO_RAD;
const LX = -0.55, LY = -0.72, LZ = 0.42, LN = Math.hypot(LX, LY, LZ);
const CAM_SPIN = 0.00007;
const MIN_DISPLAY_RADIUS = 1.14;
const MAX_DISPLAY_RADIUS = 1.33;
const DISPLAY_RADIUS_LOG_SCALE = 0.22;
const MIN_PERIGEE_RADIUS = 1.03;
const MAX_DISPLAY_ECCENTRICITY = 0.14;
const ECCENTRICITY_SCALE = 0.25;
const ORBIT_SAMPLES = 1440;
const DEFAULT_PERIOD = 5400;
const VISUAL_SPEED = 60;
const MIN_VISUAL_PERIOD = 20;
const MAX_VISUAL_PERIOD = 120;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const unit = (x, y, z) => {
        const length = Math.hypot(x, y, z) || 1;
        return [x / length, y / length, z / length];
};
const cross = (a, b) => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function createGlobe({ grid }) {
        let inclination = 23 * DEG_TO_RAD, raan = 0, argPerigee = 0, eccentricity = 0, semiMajor = 1.06;
        let meanAnomaly = 0, visualMeanMotion = TAU / 20;
        let phi = 1.1, last = performance.now(), frame = 0, running = false;

        const depth = new Float32Array(W * H);
        const mask = new Uint8Array(W * H);

        function displayRadius() {
                if (!Number.isFinite(semiMajor) || semiMajor <= 1) return MIN_DISPLAY_RADIUS;
                const scaled = MIN_DISPLAY_RADIUS + DISPLAY_RADIUS_LOG_SCALE * Math.log10(semiMajor);
                return clamp(scaled, MIN_DISPLAY_RADIUS, MAX_DISPLAY_RADIUS);
        }

        function displayEccentricity() {
                const radius = displayRadius();
                const maxEccentricity = Math.max(0, (radius - MIN_PERIGEE_RADIUS) / radius);
                return Math.min(MAX_DISPLAY_ECCENTRICITY, Math.max(0, eccentricity) * ECCENTRICITY_SCALE, maxEccentricity);
        }

        function orbitBasis() {
                const ci = Math.cos(inclination), si = Math.sin(inclination);
                const co = Math.cos(raan), so = Math.sin(raan);
                const cw = Math.cos(argPerigee), sw = Math.sin(argPerigee);

                return {
                        p: [co * cw - so * sw * ci, so * cw + co * sw * ci, sw * si],
                        q: [-co * sw - so * cw * ci, -so * sw + co * cw * ci, cw * si]
                };
        }

        function cameraBasis({ p, q }) {
                const n = cross(p, q);

                // Line of nodes: the equatorial direction that lies in the orbit plane.
                const nodeLength = Math.hypot(-n[1], n[0]);
                let d = nodeLength < 1e-6 ? [1, 0, 0] : [-n[1] / nodeLength, n[0] / nodeLength, 0];

                // Tilt the camera slightly out of the orbital plane to show a side-on ellipse.
                const ct = Math.cos(CAMERA_ORBIT_TILT), st = Math.sin(CAMERA_ORBIT_TILT);
                d = unit(d[0] * ct + n[0] * st, d[1] * ct + n[1] * st, d[2] * ct + n[2] * st);

                // Start with Earth's north pole upright on screen; the roll below tilts it.
                let v = unit(-d[0] * d[2], -d[1] * d[2], 1 - d[2] * d[2]);

                // Screen right.
                let u = unit(...cross(d, v));

                // Earth's spin axis is tilted 23.44° from the ecliptic normal. Roll the
                // whole view so the globe shows that tilt, leaning the same way the orbit
                // plane rises above the equator.
                const w = [-n[2] * n[0], -n[2] * n[1], 1 - n[2] * n[2]];
                const roll = EARTH_OBLIQUITY * (dot(w, u) < 0 ? -1 : 1);
                const cr = Math.cos(roll), sr = Math.sin(roll);
                const rolledU = [u[0] * cr + v[0] * sr, u[1] * cr + v[1] * sr, u[2] * cr + v[2] * sr];
                const rolledV = [v[0] * cr - u[0] * sr, v[1] * cr - u[1] * sr, v[2] * cr - u[2] * sr];

                return { u: rolledU, v: rolledV, d };
        }

        function orbitPoint(anomaly, radius, e, { p, q }) {
                const x = radius * (Math.cos(anomaly) - e);
                const y = radius * Math.sqrt(1 - e * e) * Math.sin(anomaly);

                return [x * p[0] + y * q[0], x * p[1] + y * q[1], x * p[2] + y * q[2]];
        }

        function solveKepler(anomaly, e) {
                let eccentricAnomaly = anomaly;

                for (let iteration = 0; iteration < 6; iteration += 1) {
                        const delta = (eccentricAnomaly - e * Math.sin(eccentricAnomaly) - anomaly)
                                / (1 - e * Math.cos(eccentricAnomaly));
                        eccentricAnomaly -= delta;
                        if (Math.abs(delta) < 1e-7) break;
                }

                return eccentricAnomaly;
        }

        function updateSatellitePhase(position) {
                if (!position) return false;

                const length = Math.hypot(position.x, position.y, position.z);
                if (!length) return false;

                const { p, q } = orbitBasis();
                const sx = position.x / length, sy = position.y / length, sz = position.z / length;
                const trueAnomaly = Math.atan2(
                        sx * q[0] + sy * q[1] + sz * q[2],
                        sx * p[0] + sy * p[1] + sz * p[2]
                );
                const e = displayEccentricity();
                let eccentricAnomaly = 2 * Math.atan2(
                        Math.sqrt(1 - e) * Math.sin(trueAnomaly / 2),
                        Math.sqrt(1 + e) * Math.cos(trueAnomaly / 2)
                );

                eccentricAnomaly = ((eccentricAnomaly % TAU) + TAU) % TAU;
                meanAnomaly = ((eccentricAnomaly - e * Math.sin(eccentricAnomaly)) % TAU + TAU) % TAU;
                return true;
        }

        function setOrbit(data = {}) {
                if (Number.isFinite(data.inclination)) inclination = data.inclination;
                if (Number.isFinite(data.raan)) raan = data.raan;
                if (Number.isFinite(data.argPerigee)) argPerigee = data.argPerigee;
                if (Number.isFinite(data.eccentricity)) eccentricity = clamp(data.eccentricity, 0, 0.99);
                if (Number.isFinite(data.semiMajor)) semiMajor = Math.max(1, data.semiMajor);

                const period = Number.isFinite(data.period) && data.period > 0 ? data.period : DEFAULT_PERIOD;
                visualMeanMotion = TAU / clamp(period / VISUAL_SPEED, MIN_VISUAL_PERIOD, MAX_VISUAL_PERIOD);

                if (data.satellite) updateSatellitePhase(data.satellite);
                render();
        }

        function render() {
                if (!grid || hasActiveSelection(grid)) return;

                const basis = orbitBasis();
                const { u, v, d } = cameraBasis(basis);
                const chars = new Array(W * H);
                const styles = new Array(W * H);

                for (let row = 0; row < H; row += 1) {
                        for (let column = 0; column < W; column += 1) {
                                const index = row * W + column;
                                const sx = (column - CX) / S, sy = (CY - row) * A / S;
                                const q = 1 - sx * sx - sy * sy;
                                chars[index] = " ";
                                styles[index] = null;

                                if (q < 0) {
                                        mask[index] = 0;
                                        continue;
                                }

                                const b = -Math.sqrt(q);
                                const X = sx * u[0] + sy * v[0] + b * d[0];
                                const Y = sx * u[1] + sy * v[1] + b * d[1];
                                const Z = sx * u[2] + sy * v[2] + b * d[2];
                                const t = 0.05 + 0.95 * Math.max(0, (X * LX + Y * LY + Z * LZ) / LN);
                                const shade = Math.round(t * NR);
                                const longitude = ((Math.atan2(Y, X) + phi) * DEG + 540) % 360 - 180;
                                const onLand = isLand(longitude, Math.asin(Z) * DEG);

                                chars[index] = onLand ? RAMP[Math.min(NR, shade + 1)] : RAMP[shade];
                                styles[index] = onLand ? "globe-land" : null;
                                depth[index] = b;
                                mask[index] = 1;
                        }
                }

                const e = displayEccentricity(), radius = displayRadius();
                let previousX, previousY, previousDepth;

                for (let step = 0; step <= ORBIT_SAMPLES; step += 1) {
                        const [X, Y, Z] = orbitPoint(step / ORBIT_SAMPLES * TAU, radius, e, basis);
                        const fx = CX + (X * u[0] + Y * u[1] + Z * u[2]) * S;
                        const fy = CY - (X * v[0] + Y * v[1] + Z * v[2]) * K;
                        const fd = X * d[0] + Y * d[1] + Z * d[2];

                        if (step) {
                                const n = Math.ceil(Math.max(Math.abs(fx - previousX), Math.abs(fy - previousY)));
                                for (let s = 1; s <= n; s += 1) {
                                        const ratio = s / n;
                                        const column = Math.round(previousX + (fx - previousX) * ratio);
                                        const row = Math.round(previousY + (fy - previousY) * ratio);
                                        if (column < 0 || column >= W || row < 0 || row >= H) continue;
                                        const index = row * W + column;
                                        const depthAtPoint = previousDepth + (fd - previousDepth) * ratio;
                                        chars[index] = mask[index] && depthAtPoint >= depth[index] + 0.04
                                                ? BLOCKS.light
                                                : BLOCKS.solid;
                                        styles[index] = "globe-orbit";
                                }
                        }

                        previousX = fx;
                        previousY = fy;
                        previousDepth = fd;
                }

                const [satelliteX, satelliteY, satelliteZ] = orbitPoint(solveKepler(meanAnomaly, e), radius, e, basis);
                const satelliteColumn = Math.round(CX + (satelliteX * u[0] + satelliteY * u[1] + satelliteZ * u[2]) * S);
                const satelliteRow = Math.round(CY - (satelliteX * v[0] + satelliteY * v[1] + satelliteZ * v[2]) * K);

                const paint = (column, row, character) => {
                        if (column < 0 || column >= W || row < 0 || row >= H) return;
                        chars[row * W + column] = character;
                        styles[row * W + column] = "globe-satellite";
                };

                for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
                        for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
                                const character = rowOffset === 0 && columnOffset === 0 ? ASCII.satellite : " ";
                                paint(satelliteColumn + columnOffset, satelliteRow + rowOffset, character);
                        }
                }

                grid.innerHTML = asciiToHtml(chars, W, H, styles);
        }

        function loop(now) {
                if (!running) return;
                const delta = now - last;
                if (delta < 33) {
                        frame = requestAnimationFrame(loop);
                        return;
                }
                const elapsed = Math.min(delta, 100);
                phi += elapsed * CAM_SPIN;
                meanAnomaly = (meanAnomaly + visualMeanMotion * elapsed / 1000) % TAU;
                last = now;
                render();
                frame = requestAnimationFrame(loop);
        }

        function start() {
                if (running) return;
                running = true;
                last = performance.now();
                render();
                if (!matchMedia("(prefers-reduced-motion: reduce)").matches) frame = requestAnimationFrame(loop);
        }

        return { start, setOrbit };
}
