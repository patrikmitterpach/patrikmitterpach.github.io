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

const DEFAULT_TLE = `ISS (ZARYA)
1 25544U 98067A   26296.69304404  .00008515  00000+0  16237-3 0  9995
2 25544  51.6336  24.1765 0006871 300.7285  59.3026 15.49021515591674`;

const MAP_SOURCE = "./mercator.svg";
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
const MAP_BACKGROUND = "#ffffff";
const MAP_INK = "#3b372f";
const MAP_CELL_HEIGHT = 5;
const MAP_LAND = "#";
const MAP_COAST = "+";
const MAX_DPR = 4;

const SGP4_ERRORS = {
        1: "the TLE has an eccentricity outside the supported range",
        2: "the TLE has an invalid mean motion",
        3: "the TLE produces an invalid perturbed eccentricity",
        4: "the TLE produces a negative semi-latus rectum",
        6: "the satellite has decayed"
};

const dom = {
        canvas: document.getElementById("map"),
        mapFrame: document.getElementById("map-frame"),
        mapStatus: document.getElementById("map-status"),
        statusTracking: document.getElementById("status-tracking"),
        statusContact: document.getElementById("status-contact"),
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

const ctx = dom.canvas.getContext("2d");

let satellite = null;
let globe = null;
let mapImage = null;
let mapFallbackImage = null;
let mapLayer = null;
let view = { width: 0, height: 0, dpr: 1 };
let windowMinutes = 120;
let groundStation = { lat: 50, lng: 14, range: 1200 };
let clockId = null;
let renderQueued = false;
let resizeObserver = null;
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

function project(latitude, longitude, width, height) {
        return {
                x: ((longitude + 180) / 360) * width,
                y: ((90 - latitude) / 180) * height
        };
}

function splitAtAntimeridian(points) {
        if (points.length < 2) return [];

        const segments = [];
        let segment = [points[0]];

        for (let index = 1; index < points.length; index += 1) {
                const previous = points[index - 1];
                const current = points[index];

                if (Math.abs(current.lng - previous.lng) > 180) {
                        if (segment.length > 1) segments.push(segment);
                        segment = [current];
                } else {
                        segment.push(current);
                }
        }

        if (segment.length > 1) segments.push(segment);
        return segments;
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

function drawGeoPath(points, options) {
        const segments = splitAtAntimeridian(points);
        if (segments.length === 0) return;

        const width = view.width;
        const offsets = [-width, 0, width];

        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = options.stroke || "#111";
        ctx.lineWidth = options.lineWidth || 1;
        ctx.setLineDash(options.dash || []);

        for (const segment of segments) {
                for (const offset of offsets) {
                        ctx.beginPath();

                        segment.forEach((point, index) => {
                                const position = project(point.lat, point.lng, view.width, view.height);
                                const x = position.x + offset;

                                if (index === 0) {
                                        ctx.moveTo(x, position.y);
                                } else {
                                        ctx.lineTo(x, position.y);
                                }
                        });

                        if (options.fill) {
                                ctx.closePath();
                                ctx.fillStyle = options.fill;
                                if (options.invert) ctx.globalCompositeOperation = "difference";
                                ctx.fill();
                                ctx.globalCompositeOperation = "source-over";

                                if (options.tone) {
                                        ctx.fillStyle = options.tone;
                                        ctx.fill();
                                }
                        }

                        if (options.halo) {
                                ctx.save();
                                ctx.strokeStyle = MAP_BACKGROUND;
                                ctx.lineWidth = (options.lineWidth || 1) + 3.5;
                                ctx.setLineDash([]);
                                ctx.stroke();
                                ctx.restore();
                        }

                        if (options.stroke) ctx.stroke();
                }
        }

        ctx.restore();
}

function drawGraticule() {
        ctx.save();
        ctx.strokeStyle = "rgba(38, 35, 29, 0.18)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 6]);
        ctx.beginPath();

        for (let longitude = -150; longitude <= 150; longitude += 30) {
                const x = project(0, longitude, view.width, view.height).x;
                ctx.moveTo(x, 0);
                ctx.lineTo(x, view.height);
        }

        for (let latitude = -60; latitude <= 60; latitude += 30) {
                const y = project(latitude, 0, view.width, view.height).y;
                ctx.moveTo(0, y);
                ctx.lineTo(view.width, y);
        }

        ctx.stroke();
        ctx.restore();
}

function drawMapGlyph(glyph, x, y, size, color = MAP_INK, halo = true) {
        ctx.save();
        ctx.font = `${size}px "Departure Mono", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";

        if (halo) {
                ctx.lineWidth = 3.5;
                ctx.strokeStyle = MAP_BACKGROUND;
                ctx.strokeText(glyph, x, y);
        }

        ctx.fillStyle = color;
        ctx.fillText(glyph, x, y);
        ctx.restore();
}

function drawGroundStationMarker() {
        const position = project(groundStation.lat, groundStation.lng, view.width, view.height);
        const offsets = [-view.width, 0, view.width];

        for (const offset of offsets) {
                const x = position.x + offset;
                if (x < -16 || x > view.width + 16) continue;

                ctx.save();
                ctx.fillStyle = "rgba(253, 253, 252, 0.7)";
                ctx.fillRect(x - 9, position.y - 9, 18, 18);
                ctx.strokeStyle = MAP_INK;
                ctx.lineWidth = 1;
                ctx.strokeRect(x - 9.5, position.y - 9.5, 19, 19);
                ctx.restore();

                drawMapGlyph("X", x, position.y, 14, MAP_INK, false);
        }
}

function drawGroundStation() {
        if (groundStation.range > 0) {
                const points = circlePoints(
                        groundStation.lat,
                        groundStation.lng,
                        groundStation.range
                );

                drawGeoPath(points, {
                        stroke: MAP_INK,
                        lineWidth: 3,
                        fill: MAP_BACKGROUND,
                        invert: true,
                        halo: true,
                        tone: "rgba(253, 253, 252, 0.22)"
                });
        }
}

function drawSatelliteMarker(current) {
        const position = project(current.lat, current.lng, view.width, view.height);
        const offsets = [-view.width, 0, view.width];

        for (const offset of offsets) {
                const x = position.x + offset;

                if (x < -16 || x > view.width + 16) continue;

                drawMapGlyph("@", x, position.y, 16);

                ctx.save();
                ctx.strokeStyle = MAP_INK;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x - 14, position.y);
                ctx.lineTo(x - 10, position.y);
                ctx.moveTo(x + 10, position.y);
                ctx.lineTo(x + 14, position.y);
                ctx.moveTo(x, position.y - 14);
                ctx.lineTo(x, position.y - 11);
                ctx.moveTo(x, position.y + 11);
                ctx.lineTo(x, position.y + 14);
                ctx.stroke();
                ctx.restore();
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
        dom.statusContact.classList.toggle("is-flash", Math.floor(timestamp / 1000) % 2 === 0);
}

function updateTelemetry(current, timestamp) {
        const stats = orbitStats(satellite.satrec);
        const passes = stationPasses(satellite, groundStation, timestamp);

        if (globe && stats.inclination !== null) {
                globe.setInclination(stats.inclination);
        }

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
        dom.canvas.setAttribute(
                "aria-label",
                `World map showing the ground track of ${satellite.name}. Current position ${formatLatitude(current.lat)}, ${formatLongitude(current.lng)}.`
        );
}

function render() {
        if (!satellite || view.width < 2 || view.height < 2) return;

        if (currentDpr() !== view.dpr) {
                resizeCanvas(true);
                return;
        }

        const timestamp = Date.now();
        let current;

        try {
                current = stateAt(satellite, new Date(timestamp));
        } catch (error) {
                setMessage(error.message, "error");
                return;
        }

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);

        if (mapLayer) {
                ctx.drawImage(mapLayer, 0, 0);
        } else {
                ctx.fillStyle = MAP_BACKGROUND;
                ctx.fillRect(0, 0, dom.canvas.width, dom.canvas.height);
        }

        ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

        drawGraticule();
        drawGroundStation();

        const halfWindowMs = windowMinutes * 60_000;
        const stepMs = clamp(
                Math.round(halfWindowMs / TRACK_POINT_BUDGET / 1000) * 1000,
                MIN_STEP_MS,
                MAX_STEP_MS
        );

        const past = sampleTrack(timestamp - halfWindowMs, timestamp, stepMs);
        past.push({ lat: current.lat, lng: current.lng });

        const future = sampleTrack(timestamp, timestamp + halfWindowMs, stepMs);
        future[0] = { lat: current.lat, lng: current.lng };

        drawGeoPath(past, {
                stroke: "#8a8a82",
                lineWidth: 1.2,
                dash: [1, 4],
                halo: true
        });

        drawGeoPath(future, {
                stroke: MAP_INK,
                lineWidth: 1.5,
                halo: true
        });

        drawGroundStationMarker();
        drawSatelliteMarker(current);
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

function buildLandMask(image, columns, rows) {
        const sample = document.createElement("canvas");
        sample.width = columns;
        sample.height = rows;

        const sampleContext = sample.getContext("2d", { willReadFrequently: true });
        sampleContext.imageSmoothingEnabled = false;
        sampleContext.drawImage(image, 0, 0, columns, rows);

        let pixels;

        try {
                pixels = sampleContext.getImageData(0, 0, columns, rows).data;
        } catch {
                return null;
        }

        const land = new Uint8Array(columns * rows);

        for (let index = 0; index < land.length; index += 1) {
                const offset = index * 4;

                if (pixels[offset + 3] > 32 && pixels[offset] > 200) {
                        land[index] = 1;
                }
        }

        return land;
}

function drawMapLayer(layer, image, width, height, dpr) {
        const canvasWidth = Math.round(width * dpr);
        const canvasHeight = Math.round(height * dpr);

        layer.width = canvasWidth;
        layer.height = canvasHeight;

        const context = layer.getContext("2d");
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.fillStyle = MAP_BACKGROUND;
        context.fillRect(0, 0, canvasWidth, canvasHeight);

        const cellHeight = Math.max(4, Math.round(MAP_CELL_HEIGHT * dpr));
        context.font = `${cellHeight}px "Departure Mono", monospace`;

        const cellWidth = context.measureText("0").width || cellHeight * 0.6;
        const columns = Math.max(1, Math.floor(canvasWidth / cellWidth));
        const rows = Math.max(1, Math.floor(canvasHeight / cellHeight));
        const land = buildLandMask(image, columns, rows);

        if (!land) return;

        context.fillStyle = MAP_INK;
        context.textAlign = "center";
        context.textBaseline = "middle";

        for (let row = 0; row < rows; row += 1) {
                for (let column = 0; column < columns; column += 1) {
                        const index = row * columns + column;
                        if (!land[index]) continue;

                        const touchesOcean = (row === 0 || !land[index - columns])
                                || (row === rows - 1 || !land[index + columns])
                                || (column === 0 || !land[index - 1])
                                || (column === columns - 1 || !land[index + 1]);

                        context.fillText(
                                touchesOcean ? MAP_COAST : MAP_LAND,
                                Math.round((column + 0.5) * cellWidth),
                                Math.round((row + 0.5) * cellHeight)
                        );
                }
        }
}

function rebuildMapLayer() {
        if (view.width < 2 || view.height < 2) return;

        const layer = mapLayer || document.createElement("canvas");

        if (mapImage) {
                drawMapLayer(layer, mapImage, view.width, view.height, view.dpr);
                mapLayer = layer;
                return;
        }

        layer.width = Math.round(view.width * view.dpr);
        layer.height = Math.round(view.height * view.dpr);

        const context = layer.getContext("2d");
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.fillStyle = MAP_BACKGROUND;
        context.fillRect(0, 0, layer.width, layer.height);

        if (mapFallbackImage) {
                context.imageSmoothingEnabled = true;
                context.drawImage(mapFallbackImage, 0, 0, layer.width, layer.height);
        }

        mapLayer = layer;
}

function currentDpr() {
        return Math.min(window.devicePixelRatio || 1, MAX_DPR);
}

function resizeCanvas(force = false) {
        const rect = dom.canvas.getBoundingClientRect();
        const width = Math.floor(rect.width);
        const height = Math.floor(rect.height);

        if (width < 2 || height < 2) return;

        const dpr = currentDpr();

        if (!force && width === view.width && height === view.height && dpr === view.dpr) {
                return;
        }

        view = { width, height, dpr };
        dom.canvas.width = Math.round(width * dpr);
        dom.canvas.height = Math.round(height * dpr);
        rebuildMapLayer();
        requestRender();
}

function decodeImage(source) {
        return new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error("The map image could not be loaded."));
                image.src = source;
        });
}

function recolorMap(svg) {
        return svg
                .replace(/stroke\s*:\s*#4d4539/gi, "stroke:#ffffff")
                .replace(/#4d4539/gi, "#000000")
                .replace(/#79444a/gi, "#ffffff")
                .replace(/#fefee9/gi, "#ffffff")
                .replace(/#646464/gi, "#808080")
                .replace(/#666666/gi, "#808080");
}

async function imageFromSvg(svg) {
        const blob = new Blob([svg], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);

        try {
                return await decodeImage(url);
        } finally {
                URL.revokeObjectURL(url);
        }
}

async function loadMapSource(url) {
        const response = await fetch(url);

        if (!response.ok) {
                throw new Error(`Map request failed with status ${response.status}.`);
        }

        return imageFromSvg(recolorMap(await response.text()));
}

async function loadMap() {
        try {
                mapImage = await loadMapSource(MAP_SOURCE);
                mapFallbackImage = null;
                dom.mapStatus.hidden = true;
        } catch {
                try {
                        mapFallbackImage = await decodeImage(MAP_SOURCE);
                        mapImage = null;
                        dom.mapStatus.hidden = true;
                } catch {
                        mapImage = null;
                        mapFallbackImage = null;
                        dom.mapStatus.textContent = "map unavailable -- track still live";
                        dom.mapStatus.hidden = false;
                }
        }

        rebuildMapLayer();
        requestRender();
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

        return {
                name: (parsed.name || `NORAD ${satrec.satnum}`).trim() || "Unnamed satellite",
                satrec,
                tle: [line1, line2]
        };
}

function loadSatellite(rawTle, silent = false) {
        try {
                satellite = buildSatellite(rawTle);

                if (!silent) {
                        setMessage(`Tracking ${satellite.name}.`, "success");
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

        globe = createGlobe({
                base: document.getElementById("globe-base"),
                land: document.getElementById("globe-land"),
                orbit: document.getElementById("globe-orbit")
        });
        globe.start();

        loadSatellite(DEFAULT_TLE, true);

        resizeObserver = new ResizeObserver(() => resizeCanvas());
        resizeObserver.observe(dom.mapFrame);
        window.addEventListener("resize", () => resizeCanvas());

        if (window.visualViewport) {
                window.visualViewport.addEventListener("resize", () => resizeCanvas());
        }

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

        resizeCanvas(true);
        startClock();
        loadMap();

        if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(() => {
                        rebuildMapLayer();
                        requestRender();
                });
        }
}

initialize();
