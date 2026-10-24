import { isLand } from "./world.js";
import { ASCII, BLOCK_RAMP, BLOCKS, asciiToHtml, hasActiveSelection } from "./ascii.js";

export function createGlobe({ grid }) {
        const W = 100, H = 54, S = 32, A = 1.7, TAU = Math.PI * 2, DEG = 180 / Math.PI;
        const DEG_TO_RAD = Math.PI / 180;
        const CX = (W - 1) / 2, CY = (H - 1) / 2, K = S / A;
        const RAMP = BLOCK_RAMP, NR = RAMP.length - 1;
        const CAMERA_ORBIT_TILT = 18 * DEG_TO_RAD;
        const EARTH_OBLIQUITY = 23.4393 * DEG_TO_RAD;
        const LX = -0.55, LY = -0.72, LZ = 0.42, LN = Math.hypot(LX, LY, LZ);
        const baseBuf = new Array(W * H), landBuf = new Array(W * H), orbitBuf = new Array(W * H), satelliteBuf = new Array(W * H);
        const depth = new Float32Array(W * H), mask = new Uint8Array(W * H);
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

        let inclination = 23 * DEG_TO_RAD, raan = 0, argPerigee = 0, eccentricity = 0, semiMajor = 1.06;
        let meanAnomaly = 0, visualMeanMotion = TAU / 20;
        let phi = 1.1, last = performance.now(), frame = 0, running = false;

        const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

        function displayRadius() {
                if (!Number.isFinite(semiMajor) || semiMajor <= 1) return MIN_DISPLAY_RADIUS;
                const scaled = MIN_DISPLAY_RADIUS + DISPLAY_RADIUS_LOG_SCALE * Math.log10(semiMajor);
                return clamp(scaled, MIN_DISPLAY_RADIUS, MAX_DISPLAY_RADIUS);
        }

        function displayEccentricity() {
                const radius = displayRadius();
                const maxEccentricity = Math.max(0, (radius - MIN_PERIGEE_RADIUS) / radius);
                return Math.min(
                        MAX_DISPLAY_ECCENTRICITY,
                        Math.max(0, eccentricity) * ECCENTRICITY_SCALE,
                        maxEccentricity
                );
        }

        function orbitBasis() {
                const ci = Math.cos(inclination), si = Math.sin(inclination);
                const co = Math.cos(raan), so = Math.sin(raan);
                const cw = Math.cos(argPerigee), sw = Math.sin(argPerigee);

                return {
                        px: co * cw - so * sw * ci,
                        py: so * cw + co * sw * ci,
                        pz: sw * si,
                        qx: -co * sw - so * cw * ci,
                        qy: -so * sw + co * cw * ci,
                        qz: cw * si
                };
        }

        function cameraBasis(basis) {
                const nx = basis.py * basis.qz - basis.pz * basis.qy;
                const ny = basis.pz * basis.qx - basis.px * basis.qz;
                const nz = basis.px * basis.qy - basis.py * basis.qx;

                // Line of nodes: the equatorial direction that lies in the orbit plane.
                let dx = -ny, dy = nx, dz = 0;
                let length = Math.hypot(dx, dy, dz);
                if (length < 1e-6) {
                        dx = 1;
                        dy = 0;
                        length = 1;
                }
                dx /= length;
                dy /= length;

                // Tilt the camera slightly out of the orbital plane to show a side-on ellipse.
                const ct = Math.cos(CAMERA_ORBIT_TILT), st = Math.sin(CAMERA_ORBIT_TILT);
                dx = dx * ct + nx * st;
                dy = dy * ct + ny * st;
                dz = dz * ct + nz * st;
                length = Math.hypot(dx, dy, dz) || 1;
                dx /= length;
                dy /= length;
                dz /= length;

                // Start with Earth's north pole upright on screen; the roll below tilts it.
                let vx = -dx * dz, vy = -dy * dz, vz = 1 - dz * dz;
                length = Math.hypot(vx, vy, vz) || 1;
                vx /= length;
                vy /= length;
                vz /= length;

                // Screen right.
                let ux = dy * vz - dz * vy;
                let uy = dz * vx - dx * vz;
                let uz = dx * vy - dy * vx;
                length = Math.hypot(ux, uy, uz) || 1;
                ux /= length;
                uy /= length;
                uz /= length;

                // Earth's spin axis is tilted 23.44° from the ecliptic normal. Roll the
                // whole view so the globe shows that tilt, leaning the same way the orbit
                // plane rises above the equator. Rolling the camera (rather than moving
                // the globe on its own) leaves the inclination measured against Earth's
                // equator unchanged; only the viewing frame is rotated.
                const wx = -nz * nx, wy = -nz * ny, wz = 1 - nz * nz;
                const highSide = wx * ux + wy * uy + wz * uz < 0 ? -1 : 1;
                const roll = EARTH_OBLIQUITY * highSide;
                const cr = Math.cos(roll), sr = Math.sin(roll);
                const rolledUx = ux * cr + vx * sr;
                const rolledUy = uy * cr + vy * sr;
                const rolledUz = uz * cr + vz * sr;
                const rolledVx = vx * cr - ux * sr;
                const rolledVy = vy * cr - uy * sr;
                const rolledVz = vz * cr - uz * sr;

                return {
                        ux: rolledUx, uy: rolledUy, uz: rolledUz,
                        vx: rolledVx, vy: rolledVy, vz: rolledVz,
                        dx, dy, dz
                };
        }

        function orbitPoint(eccentricAnomaly, radius, e, basis) {
                const x = radius * (Math.cos(eccentricAnomaly) - e);
                const y = radius * Math.sqrt(1 - e * e) * Math.sin(eccentricAnomaly);

                return [
                        x * basis.px + y * basis.qx,
                        x * basis.py + y * basis.qy,
                        x * basis.pz + y * basis.qz
                ];
        }

        function solveKepler(anomaly, e) {
                let eccentricAnomaly = anomaly;

                for (let iteration = 0; iteration < 6; iteration++) {
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

                const sx = position.x / length, sy = position.y / length, sz = position.z / length;
                const basis = orbitBasis();
                const trueAnomaly = Math.atan2(
                        sx * basis.qx + sy * basis.qy + sz * basis.qz,
                        sx * basis.px + sy * basis.py + sz * basis.pz
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
                const visualPeriod = clamp(period / VISUAL_SPEED, MIN_VISUAL_PERIOD, MAX_VISUAL_PERIOD);
                visualMeanMotion = TAU / visualPeriod;

                if (data.satellite) {
                        updateSatellitePhase(data.satellite);
                }

                render();
        }

        function render() {
                if (!grid || hasActiveSelection(grid)) return;

                const basis = orbitBasis(), camera = cameraBasis(basis);

                for (let row = 0; row < H; row++) {
                        for (let column = 0; column < W; column++) {
                                const index = row * W + column;
                                const sx = (column - CX) / S, sy = (CY - row) * A / S;
                                const q = 1 - sx * sx - sy * sy;
                                orbitBuf[index] = " ";
                                satelliteBuf[index] = " ";

                                if (q < 0) {
                                        baseBuf[index] = " ";
                                        landBuf[index] = " ";
                                        mask[index] = 0;
                                        continue;
                                }

                                const b = -Math.sqrt(q);
                                const X = sx * camera.ux + sy * camera.vx + b * camera.dx;
                                const Y = sx * camera.uy + sy * camera.vy + b * camera.dy;
                                const Z = sx * camera.uz + sy * camera.vz + b * camera.dz;
                                const t = 0.05 + 0.95 * Math.max(0, (X * LX + Y * LY + Z * LZ) / LN);
                                const shade = Math.round(t * NR);
                                const longitude = ((Math.atan2(Y, X) + phi) * DEG + 540) % 360 - 180;
                                const onLand = isLand(longitude, Math.asin(Z) * DEG);

                                baseBuf[index] = RAMP[shade];
                                landBuf[index] = onLand ? RAMP[Math.min(NR, shade + 1)] : " ";
                                depth[index] = b;
                                mask[index] = 1;
                        }
                }

                const put = (column, row, character) => {
                        if (column < 0 || column >= W || row < 0 || row >= H) return;
                        orbitBuf[row * W + column] = character;
                };

                // for (let step = 0; step < 900; step++) {
                //         const t = step / 900 * TAU, x = 1.005 * Math.cos(t), y = 1.005 * Math.sin(t);
                //         put(Math.round(CX + x * S), Math.round(CY - (y * sE) * S / A), "░");
                // }

                // for (let t = 1.04; t < 1.34; t += 0.05) {
                //         const row = Math.round(CY - t * cE * S / A), row2 = Math.round(CY + t * cE * S / A);
                //         put(Math.round(CX), row, "█");
                //         put(Math.round(CX), row2, "█");
                // }

                const e = displayEccentricity(), radius = displayRadius();
                let px, py, pd;

                for (let step = 0; step <= ORBIT_SAMPLES; step++) {
                        const [X, Y, Z] = orbitPoint(step / ORBIT_SAMPLES * TAU, radius, e, basis);
                        const fx = CX + (X * camera.ux + Y * camera.uy + Z * camera.uz) * S;
                        const fy = CY - (X * camera.vx + Y * camera.vy + Z * camera.vz) * K;
                        const fd = X * camera.dx + Y * camera.dy + Z * camera.dz;

                        if (step) {
                                const n = Math.ceil(Math.max(Math.abs(fx - px), Math.abs(fy - py)));
                                for (let s = 1; s <= n; s++) {
                                        const u = s / n, c = Math.round(px + (fx - px) * u), r = Math.round(py + (fy - py) * u);
                                        if (c < 0 || c >= W || r < 0 || r >= H) continue;
                                        const index = r * W + c;
                                        const d = pd + (fd - pd) * u;
                                        orbitBuf[index] = mask[index] && d >= depth[index] + 0.04 ? BLOCKS.light : BLOCKS.solid;
                                }
                        }

                        px = fx; py = fy; pd = fd;
                }

                const [satelliteX, satelliteY, satelliteZ] = orbitPoint(solveKepler(meanAnomaly, e), radius, e, basis);
                const satelliteColumn = Math.round(CX + (satelliteX * camera.ux + satelliteY * camera.uy + satelliteZ * camera.uz) * S);
                const satelliteRow = Math.round(CY - (satelliteX * camera.vx + satelliteY * camera.vy + satelliteZ * camera.vz) * K);

                const paintSatellite = (column, row, character) => {
                        if (column < 0 || column >= W || row < 0 || row >= H) return;
                        satelliteBuf[row * W + column] = character;
                };

                if (satelliteColumn >= 0 && satelliteColumn < W && satelliteRow >= 0 && satelliteRow < H) {
                        paintSatellite(satelliteColumn, satelliteRow, ASCII.satellite);
                        paintSatellite(satelliteColumn - 1, satelliteRow, "+");
                        paintSatellite(satelliteColumn + 1, satelliteRow, "+");
                        paintSatellite(satelliteColumn, satelliteRow - 1, "+");
                        paintSatellite(satelliteColumn, satelliteRow + 1, "+");
                }

                const chars = new Array(W * H);
                const styles = new Array(W * H);

                for (let index = 0; index < chars.length; index += 1) {
                        if (satelliteBuf[index] !== " ") {
                                chars[index] = satelliteBuf[index];
                                styles[index] = "globe-satellite";
                        } else if (orbitBuf[index] !== " ") {
                                chars[index] = orbitBuf[index];
                                styles[index] = "globe-orbit";
                        } else if (landBuf[index] !== " ") {
                                chars[index] = landBuf[index];
                                styles[index] = "globe-land";
                        } else {
                                chars[index] = baseBuf[index];
                                styles[index] = null;
                        }
                }

                if (!hasActiveSelection(grid)) {
                        grid.innerHTML = asciiToHtml(chars, W, H, styles);
                }
        }

        function loop(now) {
                if (!running) return;
                const delta = now - last;
                if (delta < 33) { frame = requestAnimationFrame(loop); return; }
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

        function stop() {
                running = false;
                cancelAnimationFrame(frame);
        }

        function setInclination(degrees) {
                if (!Number.isFinite(degrees)) return;
                inclination = degrees * DEG_TO_RAD;
                render();
        }

        return { start, stop, setInclination, setOrbit, render };
}
