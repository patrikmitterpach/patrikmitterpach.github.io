export function createGlobe({ base, land, orbit }) {
        const W = 100, H = 54, S = 32, A = 1.7, E = 0.22, TAU = Math.PI * 2, DEG = 180 / Math.PI;
        const CX = (W - 1) / 2, CY = (H - 1) / 2;
        const RAMP = ".,:-=+*#%@", NR = RAMP.length - 1;
        const sE = Math.sin(E), cE = Math.cos(E);
        const LX = -0.55, LY = -0.72, LZ = 0.42, LN = Math.hypot(LX, LY, LZ);
        const baseBuf = new Array(W * H), landBuf = new Array(W * H), orbitBuf = new Array(W * H);
        const depth = new Float32Array(W * H), mask = new Uint8Array(W * H);
        const CAM_SPIN = 0.00014;

        const LAND = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf4P+AAAAAAAAAAAAAAAD+P//AAAAAAAAAAAAAAYL8f/+AAAAAADgAAAAAAYv8B/+AAAAAH/9BAAA8AD//g/4AAMADf///+AB/////4/gAB/z///////A////7wcAAD////////+B///+DAMAAPf//////9cAIP/+DoAAALP/////+BAAAD//j8AAACf/////8DAAAB//7+AAB////////CAAAAf//wAAB////////AAAAAf//wAAB/9f////9AAAAAf//gAAF34f////4AAAAAf/+AAAHBz/////gAAAAAf/+AAAHAX////+gAAAAAP/8AAAD4A////8AAAAAAH/4AAAH+Y////+AAAAAAB8IAAAP/+////+AAAAAAA8AAAAf///P//8AAAAAAAYAAAAf//fx/fwAAAAAAAcgAAAf//Pg8fgAAAAAAAHgAAA///vA4fAAAAAAAAAwAAA///8AYHAAAAAAAAAR0AAf//+AYBAAAAAAAAAD8AAP//+AAAAAAAAAAAAD/gAEP/8AAAMAAAAAAAAD/gAAH/4AAG4AAAAAAAAH/4AAH/wAACYAAAAAAAAH/+AAD/gAAAAHAAAAAAAH//AAD/gAAAADgAAAAAAD//AAD/gAAAAAAAAAAAAB/+AAD/yAAAAZAAAAAAAA/+AAD/mAAAB9gAAAAAAAf+AAD/EAAAD/gAAAAAAAf8AAB/MAAAP/wAAAAAAA/wAAB+AAAAP/4AAAAAAA/wAAB+AAAAP/4AAAAAAA/gAAA8AAAAH/4AAAAAAA/AAAAgAAAAEDwAAAAAAB+AAAAAAAAAABwAAAAAAB4AAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAABwAAAAAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAADwH///gAAAAAAA4AAALv/+/////AAAAQL08AAf/////////wAB////gAH//////////gAD////AcP//////////AAH////8////////////g////////////////////////////////////////";

        const BITS = Uint8Array.from(atob(LAND), (character) => character.charCodeAt(0));
        const isLand = (longitude, latitude) => {
                const column = ((longitude + 180) / 3) | 0, row = ((90 - latitude) / 3) | 0;
                if (column < 0 || column > 119 || row < 0 || row > 59) return 0;
                const index = row * 120 + column;
                return (BITS[index >> 3] >> (7 - (index & 7))) & 1;
        };

        let inc = 23 * Math.PI / 180, phi = 1.1, last = performance.now(), frame = 0, running = false;

        function render() {
                const cs = Math.cos(phi), sn = Math.sin(phi);

                for (let row = 0; row < H; row++) {
                        for (let column = 0; column < W; column++) {
                                const index = row * W + column;
                                const X = (column - CX) / S, a = (CY - row) * A / S;
                                const q = 1 - X * X - a * a;
                                orbitBuf[index] = " ";

                                if (q < 0) {
                                        baseBuf[index] = " ";
                                        landBuf[index] = " ";
                                        mask[index] = 0;
                                        continue;
                                }

                                const b = -Math.sqrt(q), Y = a * sE + b * cE, Z = a * cE - b * sE;
                                const t = 0.05 + 0.95 * Math.max(0, (X * LX + Y * LY + Z * LZ) / LN);
                                const shade = Math.round(t * 7);
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

                for (let step = 0; step < 900; step++) {
                        const t = step / 900 * TAU, x = 1.005 * Math.cos(t), y = 1.005 * Math.sin(t);
                        put(Math.round(CX + x * S), Math.round(CY - (y * sE) * S / A), ".");
                }

                for (let t = 1.04; t < 1.34; t += 0.05) {
                        const row = Math.round(CY - t * cE * S / A), row2 = Math.round(CY + t * cE * S / A);
                        put(Math.round(CX), row, "|");
                        put(Math.round(CX), row2, "|");
                }

                const R = 1.16, K = S / A, ci = Math.cos(inc), si = Math.sin(inc);
                const ux = cs, uy = -sn, uz = 0, vx = sn * ci, vy = cs * ci, vz = si;
                const m00 = R * S * ux, m01 = R * S * vx;
                const m10 = -R * K * (uy * sE + uz * cE), m11 = -R * K * (vy * sE + vz * cE);
                const det = m00 * m11 - m01 * m10;

                if (Math.abs(det) > 20) {
                        for (let row = 0; row < H; row++) {
                                for (let column = 0; column < W; column++) {
                                        const px = column - CX, py = row - CY;
                                        const qx = (m11 * px - m01 * py) / det, qy = (m00 * py - m10 * px) / det;
                                        const ql = Math.hypot(qx, qy);
                                        if (!ql) continue;
                                        const hx = qx / ql, hy = qy / ql;
                                        if (Math.abs(ql - 1) * Math.hypot(m00 * hx + m01 * hy, m10 * hx + m11 * hy) > 0.55) continue;

                                        const t = Math.atan2(qy, qx), ct = Math.cos(t), st = Math.sin(t);
                                        const Y = R * (uy * ct + vy * st), Z = R * (uz * ct + vz * st), index = row * W + column;
                                        if (!mask[index] || Y * cE - Z * sE < depth[index] + 0.04) orbitBuf[index] = "O";
                                }
                        }
                } else {
                        const N = 900;
                        let px, py, pd;

                        for (let step = 0; step <= N; step++) {
                                const t = step / N * TAU, st = Math.sin(t), ct = Math.cos(t);
                                const X = R * (ux * ct + vx * st), Y = R * (uy * ct + vy * st), Z = R * (uz * ct + vz * st);
                                const fx = CX + X * S, fy = CY - (Y * sE + Z * cE) * K, fd = Y * cE - Z * sE;

                                if (step) {
                                        const n = Math.ceil(Math.max(Math.abs(fx - px), Math.abs(fy - py)));
                                        for (let s = 1; s <= n; s++) {
                                                const u = s / n, c = Math.round(px + (fx - px) * u), r = Math.round(py + (fy - py) * u);
                                                if (c < 0 || c >= W || r < 0 || r >= H) continue;
                                                const index = r * W + c;
                                                if (!mask[index] || pd + (fd - pd) * u < depth[index] + 0.04) orbitBuf[index] = "O";
                                        }
                                }

                                px = fx; py = fy; pd = fd;
                        }
                }

                const toString = (buffer) => {
                        let text = "";
                        for (let row = 0; row < H; row++) text += buffer.slice(row * W, row * W + W).join("") + "\n";
                        return text;
                };

                base.textContent = toString(baseBuf);
                land.textContent = toString(landBuf);
                orbit.textContent = toString(orbitBuf);
        }

        function loop(now) {
                if (!running) return;
                const delta = now - last;
                if (delta < 33) { frame = requestAnimationFrame(loop); return; }
                phi += Math.min(delta, 100) * CAM_SPIN;
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
                inc = degrees * Math.PI / 180;
                render();
        }

        return { start, stop, setInclination, render };
}
