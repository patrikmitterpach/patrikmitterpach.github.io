import { parseTLE } from "./tle.js/parsing.mjs";
import {
        twoline2satrec,
        propagate,
        gstime,
        eciToGeodetic,
        eciToEcf,
        ecfToLookAngles,
        degreesLat,
        degreesLong
} from "./tle.js/satellite-js/index.mjs";
import { createGlobe } from "./globe.js";
import { MAP_COLUMNS, MAP_LAND_ROWS, MAP_ROWS } from "./world.js";
import { ASCII, asciiToHtml, hasActiveSelection } from "./ascii.js";

const DEFAULT_TLE = `ISS (ZARYA)
1 25544U 98067A   26296.69304404  .00008515  00000+0  16237-3 0  9995
2 25544  51.6336  24.1765 0006871 300.7285  59.3026 15.49021515591674`;

const EARTH_RADIUS_KM = 6371.0088;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const TAU = Math.PI * 2;
const CIRCLE_STEPS = 360;
const TRACK_POINT_BUDGET = 180;
const MIN_STEP_MS = 10_000;
const MAX_STEP_MS = 30_000;
const PASS_WINDOW_MS = 24 * 60 * 60 * 1000;
const PASS_STEP_MS = 60_000;
const PASS_CACHE_MS = 10 * 60 * 1000;
const ORBIT_REFRESH_MS = 10_000;
const FUTURE_TRACK_GAP_CELLS = 3;

const SGP4_ERRORS = {
        1: "the TLE has an eccentricity outside the supported range",
        2: "the TLE has an invalid mean motion",
        3: "the TLE produces an invalid perturbed eccentricity",
        4: "the TLE produces a negative semi-latus rectum",
        6: "the satellite has decayed"
};

const dom = {
        mapStage: document.getElementById("map-stage"),
        mapGrid: document.getElementById("map-grid"),
        statusTracking: document.getElementById("status-tracking"),
        statusContactValue: document.getElementById("status-contact-value"),
        statusLength: document.getElementById("status-length"),
        statusAosValue: document.getElementById("status-aos-value"),
        statusLosValue: document.getElementById("status-los-value"),
        statusGs: document.getElementById("status-gs"),
        telemetry: document.getElementById("telemetry"),
        windowMinutes: document.getElementById("window-minutes"),
        windowValue: document.getElementById("window-value"),
        gsLatitude: document.getElementById("gs-latitude"),
        gsLongitude: document.getElementById("gs-longitude"),
        gsRange: document.getElementById("gs-range"),
        gsSummary: document.getElementById("gs-summary"),
        tleInput: document.getElementById("tle-input"),
        tleButton: document.getElementById("tle-button"),
        tleReset: document.getElementById("tle-reset"),
        tleMessage: document.getElementById("tle-message")
};

let satellite = null;
let globe = null;
let mapBaseChars = null;
let mapBaseStyles = null;
let windowMinutes = 120;
let groundStation = { lat: 50, lng: 14, range: 1200 };
let clockId = null;
let renderQueued = false;
let passCache = { key: "", count: null };
let rangePassCache = { key: "", inRange: false, until: null, start: null, end: null, length: null };

function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
}

function roundTo(value, decimals) {
        return Number(value.toFixed(decimals));
}

function normalizeLongitude(value) {
        return ((((value + 180) % 360) + 360) % 360) - 180;
}

function mapPoint(latitude, longitude) {
        return {
                x: ((normalizeLongitude(longitude) + 180) / 360) * MAP_COLUMNS,
                y: ((90 - clamp(latitude, -90, 90)) / 180) * MAP_ROWS
        };
}

function mapCell(latitude, longitude) {
        const point = mapPoint(latitude, longitude);

        return {
                column: clamp(Math.round(point.x - 0.5), 0, MAP_COLUMNS - 1),
                row: clamp(Math.round(point.y - 0.5), 0, MAP_ROWS - 1)
        };
}

function mapCellDistance(a, b) {
        const deltaColumn = Math.abs(a.column - b.column);

        return Math.hypot(
                Math.min(deltaColumn, MAP_COLUMNS - deltaColumn),
                a.row - b.row
        );
}

function trimFutureTrack(points, origin) {
        let start = 0;

        while (
                start < points.length - 1
                && mapCellDistance(mapCell(points[start].lat, points[start].lng), origin) < FUTURE_TRACK_GAP_CELLS
        ) {
                start += 1;
        }

        return points.slice(start);
}

function createMapGrid() {
        return {
                chars: mapBaseChars ? mapBaseChars.slice() : new Array(MAP_COLUMNS * MAP_ROWS).fill(" "),
                styles: mapBaseStyles ? mapBaseStyles.slice() : new Array(MAP_COLUMNS * MAP_ROWS).fill(null)
        };
}

function plotMapCell(grid, column, row, character, style = null) {
        if (column < 0 || column >= MAP_COLUMNS || row < 0 || row >= MAP_ROWS) return;

        const index = row * MAP_COLUMNS + column;
        grid.chars[index] = character;
        grid.styles[index] = style;
}

function plotMapSatellite(grid, column, row) {
        for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
                const targetRow = row + rowOffset;
                if (targetRow < 0 || targetRow >= MAP_ROWS) continue;

                for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
                        for (const wrapOffset of [-MAP_COLUMNS, 0, MAP_COLUMNS]) {
                                const targetColumn = column + columnOffset + wrapOffset;
                                if (targetColumn < 0 || targetColumn >= MAP_COLUMNS) continue;

                                const character = rowOffset === 0 && columnOffset === 0
                                        ? ASCII.satellite
                                        : " ";
                                plotMapCell(grid, targetColumn, targetRow, character, "map-sat");
                        }
                }
        }
}

function drawMapLineAtOffset(grid, x0, y0, x1, y1, character, style) {
        let x = x0;
        let y = y0;
        const dx = Math.abs(x1 - x0);
        const sx = x0 < x1 ? 1 : -1;
        const dy = -Math.abs(y1 - y0);
        const sy = y0 < y1 ? 1 : -1;
        let error = dx + dy;

        while (true) {
                plotMapCell(grid, x, y, character, style);

                if (x === x1 && y === y1) break;

                const doubled = error * 2;

                if (doubled >= dy) {
                        error += dy;
                        x += sx;
                }

                if (doubled <= dx) {
                        error += dx;
                        y += sy;
                }
        }
}

function drawMapLine(grid, x0, y0, x1, y1, character, style) {
        for (const offset of [-MAP_COLUMNS, 0, MAP_COLUMNS]) {
                drawMapLineAtOffset(grid, x0 + offset, y0, x1 + offset, y1, character, style);
        }
}

function drawMapPath(grid, points, character, style) {
        let previous = null;

        for (const point of points) {
                const cell = mapCell(point.lat, point.lng);

                if (previous && Math.abs(point.lng - previous.lng) <= 180) {
                        drawMapLine(
                                grid,
                                previous.cell.column,
                                previous.cell.row,
                                cell.column,
                                cell.row,
                                character,
                                style
                        );
                } else {
                        plotMapCell(grid, cell.column, cell.row, character, style);
                }

                previous = { cell, lng: point.lng };
        }
}

function destinationPoint(latitude, longitude, bearing, distanceKm) {
        const angularDistance = distanceKm / EARTH_RADIUS_KM;
        const phi1 = latitude * DEG_TO_RAD;
        const lambda1 = longitude * DEG_TO_RAD;
        const theta = bearing * DEG_TO_RAD;

        const sinPhi2 = Math.sin(phi1) * Math.cos(angularDistance)
                + Math.cos(phi1) * Math.sin(angularDistance) * Math.cos(theta);
        const phi2 = Math.asin(clamp(sinPhi2, -1, 1));
        const lambda2 = lambda1 + Math.atan2(
                Math.sin(theta) * Math.sin(angularDistance) * Math.cos(phi1),
                Math.cos(angularDistance) - Math.sin(phi1) * Math.sin(phi2)
        );

        return {
                lat: phi2 * RAD_TO_DEG,
                lng: normalizeLongitude(lambda2 * RAD_TO_DEG)
        };
}

function circlePoints(latitude, longitude, radiusKm) {
        const points = [];

        for (let index = 0; index <= CIRCLE_STEPS; index += 1) {
                const bearing = (index / CIRCLE_STEPS) * 360;
                points.push(destinationPoint(latitude, longitude, bearing, radiusKm));
        }

        return points;
}

function buildBaseMap() {
        const chars = new Array(MAP_COLUMNS * MAP_ROWS).fill(" ");
        const styles = new Array(MAP_COLUMNS * MAP_ROWS).fill(null);

        for (let row = 0; row < MAP_ROWS; row += 1) {
                const line = (MAP_LAND_ROWS[row] || "").padEnd(MAP_COLUMNS, " ");

                for (let column = 0; column < MAP_COLUMNS; column += 1) {
                        const source = line[column];
                        const index = row * MAP_COLUMNS + column;

                        if (source === "#") {
                                chars[index] = ASCII.land;
                        } else if (source === "+") {
                                chars[index] = ASCII.coast;
                                styles[index] = "map-coast";
                        }
                }
        }

        for (let longitude = -150; longitude <= 150; longitude += 30) {
                const column = clamp(
                        Math.round(((longitude + 180) / 360) * MAP_COLUMNS - 0.5),
                        0,
                        MAP_COLUMNS - 1
                );

                for (let row = 0; row < MAP_ROWS; row += 1) {
                        const index = row * MAP_COLUMNS + column;
                        if (chars[index] === " ") {
                                chars[index] = ASCII.graticule;
                                styles[index] = "map-graticule";
                        }
                }
        }

        for (let latitude = -60; latitude <= 60; latitude += 30) {
                const row = clamp(
                        Math.round(((90 - latitude) / 180) * MAP_ROWS - 0.5),
                        0,
                        MAP_ROWS - 1
                );

                for (let column = 0; column < MAP_COLUMNS; column += 1) {
                        const index = row * MAP_COLUMNS + column;
                        if (chars[index] === " ") {
                                chars[index] = ASCII.graticule;
                                styles[index] = "map-graticule";
                        }
                }
        }

        mapBaseChars = chars;
        mapBaseStyles = styles;
        dom.mapGrid.innerHTML = asciiToHtml(chars, MAP_COLUMNS, MAP_ROWS, styles);
}

function fillStationRange(grid) {
        if (groundStation.range <= 0) return;

        for (let row = 0; row < MAP_ROWS; row += 1) {
                const latitude = 90 - ((row + 0.5) / MAP_ROWS) * 180;

                for (let column = 0; column < MAP_COLUMNS; column += 1) {
                        const longitude = ((column + 0.5) / MAP_COLUMNS) * 360 - 180;

                        if (distanceKm(latitude, longitude, groundStation.lat, groundStation.lng) > groundStation.range) {
                                continue;
                        }

                        const index = row * MAP_COLUMNS + column;
                        grid.styles[index] = grid.styles[index]
                                ? `${grid.styles[index]} map-gs-area`
                                : "map-gs-area";
                }
        }
}

function renderMap(past, future, current) {
        const grid = createMapGrid();
        const satelliteCell = mapCell(current.lat, current.lng);
        const visibleFuture = trimFutureTrack(future, satelliteCell);

        fillStationRange(grid);
        drawMapPath(grid, past, ASCII.orbitPast, "map-orbit-past");
        drawMapPath(grid, visibleFuture, ASCII.orbitFuture, "map-orbit-future");

        if (groundStation.range > 0) {
                const points = circlePoints(
                        groundStation.lat,
                        groundStation.lng,
                        groundStation.range
                );

                drawMapPath(grid, points, ASCII.range, "map-range");
        }

        const groundCell = mapCell(groundStation.lat, groundStation.lng);
        plotMapCell(grid, groundCell.column, groundCell.row, ASCII.groundStation, "map-gs");

        plotMapSatellite(grid, satelliteCell.column, satelliteCell.row);

        if (!hasActiveSelection(dom.mapGrid)) {
                dom.mapGrid.innerHTML = asciiToHtml(grid.chars, MAP_COLUMNS, MAP_ROWS, grid.styles);
        }
}

function describeSatrecError(code) {
        return SGP4_ERRORS[code] || "the TLE could not be propagated";
}

function isFiniteVector(vector) {
        return Boolean(vector)
                && Number.isFinite(vector.x)
                && Number.isFinite(vector.y)
                && Number.isFinite(vector.z);
}

function stateAt(satelliteRecord, date) {
        const positionAndVelocity = propagate(satelliteRecord.satrec, date);

        if (
                !positionAndVelocity
                || !isFiniteVector(positionAndVelocity.position)
                || !isFiniteVector(positionAndVelocity.velocity)
        ) {
                const message = satelliteRecord.satrec.error
                        ? describeSatrecError(satelliteRecord.satrec.error)
                        : "the TLE contains invalid numeric fields";
                throw new Error(message);
        }

        const gmst = gstime(date);
        const geodetic = eciToGeodetic(positionAndVelocity.position, gmst);
        const { x, y, z } = positionAndVelocity.velocity;
        const velocity = Math.sqrt((x * x) + (y * y) + (z * z));

        if (
                !Number.isFinite(geodetic.latitude)
                || !Number.isFinite(geodetic.longitude)
                || !Number.isFinite(geodetic.height)
                || !Number.isFinite(velocity)
        ) {
                throw new Error("the TLE contains invalid numeric fields");
        }

        return {
                lat: degreesLat(geodetic.latitude),
                lng: degreesLong(geodetic.longitude),
                height: geodetic.height,
                velocity
        };
}

function safeStateAt(satelliteRecord, timestamp) {
        try {
                return stateAt(satelliteRecord, new Date(timestamp));
        } catch {
                return null;
        }
}

function orbitStats(record) {
        const period = Number.isFinite(record.no) && record.no > 0 ? TAU / record.no : null;
        const inclination = Number.isFinite(record.inclo) ? record.inclo * RAD_TO_DEG : null;
        const eccentricity = Number.isFinite(record.ecco) ? record.ecco : 0;
        const semiMajor = Number.isFinite(record.a) ? record.a : null;
        const apogee = semiMajor === null
                ? null
                : (semiMajor * (1 + eccentricity) - 1) * EARTH_RADIUS_KM;
        const perigee = semiMajor === null
                ? null
                : (semiMajor * (1 - eccentricity) - 1) * EARTH_RADIUS_KM;
        const orbitsPerDay = period === null ? null : 1440 / period;

        return {
                period: Number.isFinite(period) ? period : null,
                inclination: Number.isFinite(inclination) ? inclination : null,
                apogee: Number.isFinite(apogee) ? apogee : null,
                perigee: Number.isFinite(perigee) ? perigee : null,
                orbitsPerDay: Number.isFinite(orbitsPerDay) ? orbitsPerDay : null
        };
}

function elevationAt(record, station, timestamp) {
        const date = new Date(timestamp);
        const positionAndVelocity = propagate(record.satrec, date);

        if (!positionAndVelocity || !isFiniteVector(positionAndVelocity.position)) {
                return null;
        }

        const satelliteEcf = eciToEcf(positionAndVelocity.position, gstime(date));
        const observer = {
                longitude: station.lng * DEG_TO_RAD,
                latitude: station.lat * DEG_TO_RAD,
                height: 0
        };
        const look = ecfToLookAngles(observer, satelliteEcf);

        return Number.isFinite(look.elevation) ? look.elevation : null;
}

function countStationPasses(record, station, startTimestamp) {
        let count = 0;
        let aboveHorizon = false;

        for (let offset = 0; offset <= PASS_WINDOW_MS; offset += PASS_STEP_MS) {
                const elevation = elevationAt(record, station, startTimestamp + offset);
                if (elevation === null) continue;

                const visible = elevation > 0;

                if (visible && !aboveHorizon) count += 1;
                aboveHorizon = visible;
        }

        return count;
}

function stationPasses(record, station, timestamp) {
        const key = [
                record.tle.join("|"),
                station.lat,
                station.lng,
                Math.floor(timestamp / PASS_CACHE_MS)
        ].join("|");

        if (passCache.key === key) return passCache.count;

        let count = null;

        try {
                count = countStationPasses(record, station, timestamp);
        } catch {
                count = null;
        }

        passCache = { key, count };
        return count;
}

function sampleTrack(startTimestamp, endTimestamp, stepMs) {
        const points = [];

        for (let timestamp = startTimestamp; timestamp <= endTimestamp; timestamp += stepMs) {
                const state = safeStateAt(satellite, timestamp);
                if (state) points.push({ lat: state.lat, lng: state.lng });
        }

        return points;
}

function formatLatitude(latitude) {
        return `${Math.abs(latitude).toFixed(3)}°${latitude >= 0 ? "N" : "S"}`;
}

function formatLongitude(longitude) {
        return `${Math.abs(longitude).toFixed(3)}°${longitude >= 0 ? "E" : "W"}`;
}

function distanceKm(latitude, longitude, targetLatitude, targetLongitude) {
        const deltaLatitude = (targetLatitude - latitude) * DEG_TO_RAD;
        const deltaLongitude = (targetLongitude - longitude) * DEG_TO_RAD;
        const a = Math.sin(deltaLatitude / 2) ** 2
                + Math.cos(latitude * DEG_TO_RAD)
                * Math.cos(targetLatitude * DEG_TO_RAD)
                * Math.sin(deltaLongitude / 2) ** 2;

        return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function stationRangeInfo(current, timestamp) {
        const inRange = distanceKm(
                current.lat,
                current.lng,
                groundStation.lat,
                groundStation.lng
        ) <= groundStation.range;
        const bucket = inRange ? 30_000 : 300_000;
        const key = [
                satellite.tle.join("|"),
                groundStation.lat,
                groundStation.lng,
                groundStation.range,
                Math.floor(timestamp / bucket)
        ].join("|");

        if (rangePassCache.key === key && (!rangePassCache.until || timestamp < rangePassCache.until)) {
                return rangePassCache;
        }

        const step = inRange ? 10_000 : 60_000;
        const limit = inRange ? 3_600_000 : 86_400_000;
        let until = null;

        for (let offset = step; offset <= limit; offset += step) {
                const state = safeStateAt(satellite, timestamp + offset);
                if (!state) continue;

                const inside = distanceKm(
                        state.lat,
                        state.lng,
                        groundStation.lat,
                        groundStation.lng
                ) <= groundStation.range;

                if (inside !== inRange) {
                        until = timestamp + offset;
                        break;
                }
        }

        let start = null;
        let end = null;

        if (inRange) {
                end = until;
        } else if (until !== null) {
                start = until;

                for (let offset = 30_000; offset <= 7_200_000; offset += 30_000) {
                        const state = safeStateAt(satellite, until + offset);
                        if (!state) continue;

                        const inside = distanceKm(
                                state.lat,
                                state.lng,
                                groundStation.lat,
                                groundStation.lng
                        ) <= groundStation.range;

                        if (!inside) {
                                end = until + offset;
                                break;
                        }
                }
        }

        if (inRange && end !== null) {
                start = end;

                for (let offset = 30_000; offset <= 7_200_000; offset += 30_000) {
                        const state = safeStateAt(satellite, timestamp - offset);
                        if (!state) continue;

                        const inside = distanceKm(
                                state.lat,
                                state.lng,
                                groundStation.lat,
                                groundStation.lng
                        ) <= groundStation.range;

                        if (!inside) {
                                start = timestamp - offset + 30_000;
                                break;
                        }
                }
        }

        const length = start !== null && end !== null ? end - start : null;
        rangePassCache = { key, inRange, until, start, end, length };
        return rangePassCache;
}

function formatDuration(milliseconds) {
        return new Date(Math.max(0, milliseconds)).toISOString().slice(11, 19);
}

function formatClock(timestamp) {
        return `${new Date(timestamp).toISOString().slice(11, 19)} UTC`;
}

function renderTelemetry(rows) {
        dom.telemetry.replaceChildren(...rows.map(([label, value, unit]) => {
                const row = document.createElement("div");
                row.className = "ov-table-row telemetry-row";

                for (const text of [label, value, unit]) {
                        const span = document.createElement("span");
                        span.textContent = text;
                        row.append(span);
                }

                return row;
        }));
}

function updateStatus(current, timestamp) {
        const info = stationRangeInfo(current, timestamp);
        const contact = info.inRange
                ? "IN RANGE"
                : info.start === null
                        ? "--"
                        : formatDuration(info.start - timestamp);
        const gs = `${Math.abs(groundStation.lat).toFixed(1)}°${groundStation.lat >= 0 ? "N" : "S"} ${Math.abs(groundStation.lng).toFixed(1)}°${groundStation.lng >= 0 ? "E" : "W"}`;

        dom.statusTracking.textContent = satellite.name;
        dom.statusContactValue.textContent = contact;
        dom.statusLength.textContent = info.length === null ? "--" : formatDuration(info.length);
        dom.statusAosValue.textContent = info.start === null ? "--" : formatClock(info.start);
        dom.statusLosValue.textContent = info.end === null ? "--" : formatClock(info.end);
        dom.statusGs.textContent = gs;
}

function updateTelemetry(current, timestamp) {
        const stats = orbitStats(satellite.satrec);
        const passes = stationPasses(satellite, groundStation, timestamp);

        const rows = [
                ["latitude", Math.abs(current.lat).toFixed(3), `°${current.lat >= 0 ? "N" : "S"}`],
                ["longitude", Math.abs(current.lng).toFixed(3), `°${current.lng >= 0 ? "E" : "W"}`],
                ["altitude", current.height.toFixed(2), "KM"],
                ["apogee", stats.apogee === null ? "--" : stats.apogee.toFixed(2), "KM"],
                ["perigee", stats.perigee === null ? "--" : stats.perigee.toFixed(2), "KM"],
                ["velocity", current.velocity.toFixed(3), "KM/S"],
                ["period", stats.period === null ? "--" : stats.period.toFixed(2), "MIN"],
                ["inclination", stats.inclination === null ? "--" : stats.inclination.toFixed(2), "°"],
                ["orbits / day", stats.orbitsPerDay === null ? "--" : stats.orbitsPerDay.toFixed(2), ""],
                ["station passes", passes === null ? "--" : String(passes), "/24H"]
        ];

        renderTelemetry(rows);
        updateStatus(current, timestamp);
        dom.mapStage.setAttribute(
                "aria-label",
                `World map showing the ground track of ${satellite.name}. Current position ${formatLatitude(current.lat)}, ${formatLongitude(current.lng)}.`
        );
}

function render() {
        if (!satellite) return;

        const timestamp = Date.now();
        let current;

        try {
                current = stateAt(satellite, new Date(timestamp));
        } catch (error) {
                setMessage(error.message, "error");
                return;
        }

        const halfWindowMs = windowMinutes * 60_000;
        const stepMs = clamp(
                Math.round(halfWindowMs / TRACK_POINT_BUDGET / 1000) * 1000,
                MIN_STEP_MS,
                MAX_STEP_MS
        );

        const orbitTimestamp = Math.floor(timestamp / ORBIT_REFRESH_MS) * ORBIT_REFRESH_MS;
        const orbitCurrent = orbitTimestamp === timestamp
                ? current
                : safeStateAt(satellite, orbitTimestamp) || current;

        const past = sampleTrack(orbitTimestamp - halfWindowMs, orbitTimestamp, stepMs);
        past.push({ lat: orbitCurrent.lat, lng: orbitCurrent.lng });

        const future = sampleTrack(orbitTimestamp, orbitTimestamp + halfWindowMs, stepMs);
        future[0] = { lat: orbitCurrent.lat, lng: orbitCurrent.lng };

        renderMap(past, future, current);
        updateTelemetry(current, timestamp);
}

function requestRender() {
        if (renderQueued) return;

        renderQueued = true;
        requestAnimationFrame(() => {
                renderQueued = false;
                render();
        });
}

function setMessage(text, kind = "") {
        dom.tleMessage.textContent = text;
        dom.tleMessage.classList.toggle("is-error", kind === "error");
        dom.tleMessage.classList.toggle("is-success", kind === "success");
}

function buildSatellite(rawTle) {
        const lines = rawTle
                .trim()
                .split(/\r?\n/)
                .map((line) => line.trimEnd())
                .filter((line) => line.trim().length > 0);

        if (lines.length !== 2 && lines.length !== 3) {
                throw new Error("Enter two element lines, optionally preceded by a satellite name.");
        }

        const parsed = parseTLE(lines.join("\n"));

        if (!parsed.tle || parsed.tle.length !== 2) {
                throw new Error("The TLE must contain exactly two element lines.");
        }

        const [line1, line2] = parsed.tle;

        if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) {
                throw new Error("The element lines must start with 1 and 2.");
        }

        const satrec = twoline2satrec(line1, line2);

        if (satrec.error) {
                throw new Error(`Invalid TLE: ${describeSatrecError(satrec.error)}.`);
        }

        const probe = propagate(satrec, new Date());

        if (
                !probe
                || !isFiniteVector(probe.position)
                || !isFiniteVector(probe.velocity)
        ) {
                const reason = satrec.error
                        ? describeSatrecError(satrec.error)
                        : "the TLE contains invalid numeric fields";
                throw new Error(`Invalid TLE: ${reason}.`);
        }

        const radius = Math.hypot(probe.position.x, probe.position.y, probe.position.z) || 1;
        const period = Number.isFinite(satrec.no) && satrec.no > 0 ? (TAU / satrec.no) * 60 : null;

        return {
                name: (parsed.name || `NORAD ${satrec.satnum}`).trim() || "Unnamed satellite",
                satrec,
                tle: [line1, line2],
                orbit: {
                        inclination: satrec.inclo,
                        raan: satrec.nodeo,
                        argPerigee: satrec.argpo,
                        eccentricity: satrec.ecco,
                        semiMajor: satrec.a,
                        period,
                        satellite: {
                                x: probe.position.x / radius,
                                y: probe.position.y / radius,
                                z: probe.position.z / radius
                        }
                }
        };
}

function loadSatellite(rawTle, silent = false) {
        try {
                satellite = buildSatellite(rawTle);

                if (!silent) {
                        setMessage(`Tracking ${satellite.name}.`, "success");
                }

                if (globe) {
                        globe.setOrbit(satellite.orbit);
                }

                requestRender();
                return true;
        } catch (error) {
                setMessage(error.message, "error");
                return false;
        }
}

function readNumber(input) {
        const value = input.valueAsNumber;
        return Number.isFinite(value) ? value : null;
}

function markInvalid(input, invalid) {
        if (invalid) {
                input.setAttribute("aria-invalid", "true");
        } else {
                input.removeAttribute("aria-invalid");
        }
}

function refreshGroundStation() {
        const latitude = readNumber(dom.gsLatitude);
        const longitude = readNumber(dom.gsLongitude);
        const range = readNumber(dom.gsRange);

        markInvalid(dom.gsLatitude, latitude === null);
        markInvalid(dom.gsLongitude, longitude === null);
        markInvalid(dom.gsRange, range === null);

        if (latitude === null || longitude === null || range === null) {
                dom.gsSummary.textContent = "Enter a numeric latitude, longitude, and radius.";
                return false;
        }

        groundStation = {
                lat: roundTo(clamp(latitude, -90, 90), 4),
                lng: roundTo(normalizeLongitude(longitude), 4),
                range: roundTo(clamp(range, 0, 20_000), 2)
        };

        const latitudeText = `${Math.abs(groundStation.lat).toFixed(1)}°${groundStation.lat >= 0 ? "N" : "S"}`;
        const longitudeText = `${Math.abs(groundStation.lng).toFixed(1)}°${groundStation.lng >= 0 ? "E" : "W"}`;
        dom.gsSummary.textContent = `${latitudeText} ${longitudeText} -- ${Math.round(groundStation.range).toLocaleString("en-US")} km`;

        return true;
}

function updateWindowOutput() {
        dom.windowValue.textContent = `±${windowMinutes} min`;
}

function snapGroundStationInputs() {
        if (!refreshGroundStation()) return;

        dom.gsLatitude.value = groundStation.lat;
        dom.gsLongitude.value = groundStation.lng;
        dom.gsRange.value = groundStation.range;
        requestRender();
}

function startClock() {
        stopClock();
        clockId = window.setInterval(() => {
                if (!document.hidden) requestRender();
        }, 1000);
}

function stopClock() {
        if (clockId !== null) {
                window.clearInterval(clockId);
                clockId = null;
        }
}

function initialize() {
        dom.tleInput.value = DEFAULT_TLE;
        windowMinutes = clamp(Number(dom.windowMinutes.value) || 120, 10, 240);
        updateWindowOutput();
        refreshGroundStation();
        buildBaseMap();

        globe = createGlobe({
                grid: document.getElementById("globe-grid")
        });
        globe.start();

        loadSatellite(DEFAULT_TLE, true);

        dom.windowMinutes.addEventListener("input", () => {
                windowMinutes = clamp(Number(dom.windowMinutes.value) || 120, 10, 240);
                updateWindowOutput();
                requestRender();
        });

        for (const input of [dom.gsLatitude, dom.gsLongitude, dom.gsRange]) {
                input.addEventListener("input", () => {
                        if (refreshGroundStation()) requestRender();
                });

                input.addEventListener("change", snapGroundStationInputs);
        }

        dom.tleButton.addEventListener("click", () => {
                loadSatellite(dom.tleInput.value);
        });

        dom.tleReset.addEventListener("click", () => {
                dom.tleInput.value = DEFAULT_TLE;
                loadSatellite(DEFAULT_TLE);
        });

        dom.tleInput.addEventListener("keydown", (event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault();
                        loadSatellite(dom.tleInput.value);
                }
        });

        document.addEventListener("visibilitychange", () => {
                if (document.hidden) {
                        stopClock();
                } else {
                        requestRender();
                        startClock();
                }
        });

        startClock();
}

initialize();
