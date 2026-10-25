// Curated satellite catalog for the Orbivis picker.
//
// Only identity metadata is bundled with the page. TLEs are fetched on demand
// from Celestrak (with a backup service and a local cache) so the orbital data
// stays current without shipping a giant snapshot. Starlinks are intentionally
// left out; the catalog is a hand-picked set of interesting objects.

const MEMORY_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;
const STORAGE_PREFIX = "orbivis:tle:v1:";

const memoryCache = new Map();

const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");

// Catalog entries: `id` is the URL key, `name` is displayed, `noradId` drives
// the Celestrak query, and `aliases` are matched case/punctuation-insensitively.
const GROUPS = [
        {
                id: "czech",
                label: "czech",
                satellites: [
                        {
                                id: "SATURNIN-1",
                                name: "SATURNIN-1",
                                noradId: 62615,
                                aliases: ["saturnin", "transporter 12", "transporter 12 object g"]
                        },
                        {
                                id: "TROLL",
                                name: "TROLL",
                                noradId: 62658,
                                aliases: ["trl space"]
                        },
                        {
                                id: "LASARSAT",
                                name: "LASARSAT",
                                noradId: 62391,
                                aliases: ["lasar", "lasarsat-1"]
                        },
                        {
                                id: "CEVROSAT-1",
                                name: "CEVROSAT-1",
                                noradId: 66304,
                                aliases: ["cevrosat", "bandwagon 4 object m"]
                        },
                        {
                                id: "KOSTKA",
                                name: "KOSTKA",
                                noradId: 69935,
                                aliases: ["brno"]
                        },
                        {
                                id: "MAGION-5",
                                name: "MAGION 5",
                                noradId: 24292,
                                aliases: ["magion 5"]
                        }
                ]
        },
        {
                id: "stations",
                label: "stations",
                satellites: [
                        {
                                id: "ISS",
                                name: "ISS (ZARYA)",
                                noradId: 25544,
                                aliases: ["iss", "zarya", "space station", "international space station"]
                        },
                        {
                                id: "CSS",
                                name: "CSS (TIANHE)",
                                noradId: 48274,
                                aliases: ["css", "tiangong", "tianhe", "chinese space station"]
                        }
                ]
        },
        {
                id: "earth-observation",
                label: "earth observation",
                satellites: [
                        { id: "SENTINEL-1A", name: "SENTINEL-1A", noradId: 39634 },
                        { id: "SENTINEL-1C", name: "SENTINEL-1C", noradId: 62261 },
                        { id: "SENTINEL-2A", name: "SENTINEL-2A", noradId: 40697 },
                        { id: "SENTINEL-2C", name: "SENTINEL-2C", noradId: 60989 },
                        { id: "SENTINEL-3A", name: "SENTINEL-3A", noradId: 41335 },
                        { id: "SENTINEL-3B", name: "SENTINEL-3B", noradId: 43437 },
                        { id: "LANDSAT-8", name: "LANDSAT 8", noradId: 39084 },
                        { id: "LANDSAT-9", name: "LANDSAT 9", noradId: 49260 },
                        { id: "TERRA", name: "TERRA", noradId: 25994 },
                        { id: "AQUA", name: "AQUA", noradId: 27424 },
                        { id: "ICESAT-2", name: "ICESAT-2", noradId: 43613 },
                        { id: "SUOMI-NPP", name: "SUOMI NPP", noradId: 37849 }
                ]
        },
        {
                id: "weather",
                label: "weather",
                satellites: [
                        { id: "NOAA-15", name: "NOAA 15", noradId: 25338 },
                        { id: "NOAA-18", name: "NOAA 18", noradId: 28654 },
                        { id: "NOAA-19", name: "NOAA 19", noradId: 33591 },
                        { id: "NOAA-20", name: "NOAA 20 (JPSS-1)", noradId: 43013 },
                        { id: "NOAA-21", name: "NOAA 21 (JPSS-2)", noradId: 54234 },
                        { id: "METEOR-M2", name: "METEOR-M2", noradId: 40069 },
                        { id: "METEOR-M2-3", name: "METEOR-M2 3", noradId: 57166 },
                        { id: "METOP-B", name: "METOP-B", noradId: 38771 },
                        { id: "METOP-C", name: "METOP-C", noradId: 43689 },
                        { id: "GOES-16", name: "GOES 16", noradId: 41866 },
                        { id: "GOES-18", name: "GOES 18", noradId: 51850 },
                        { id: "GOES-19", name: "GOES 19", noradId: 60133 },
                        { id: "HIMAWARI-9", name: "HIMAWARI-9", noradId: 41836 },
                        { id: "METEOSAT-11", name: "METEOSAT-11", noradId: 40732 }
                ]
        },
        {
                id: "science",
                label: "science",
                satellites: [
                        {
                                id: "HUBBLE",
                                name: "HUBBLE (HST)",
                                noradId: 20580,
                                aliases: ["hubble", "hst"]
                        },
                        { id: "SWIFT", name: "SWIFT", noradId: 28485 },
                        {
                                id: "FERMI",
                                name: "FERMI (GLAST)",
                                noradId: 33053,
                                aliases: ["fermi", "glast", "fgrst"]
                        },
                        { id: "IXPE", name: "IXPE", noradId: 49954 },
                        { id: "CHEOPS", name: "CHEOPS", noradId: 44874 }
                ]
        },
        {
                id: "navigation",
                label: "navigation",
                satellites: [
                        {
                                id: "GPS-BIIR-2",
                                name: "GPS BIIR-2",
                                noradId: 24876,
                                aliases: ["gps", "navstar 43", "prn 13"]
                        },
                        {
                                id: "GPS-IIF-2",
                                name: "GPS IIF-2",
                                noradId: 37753,
                                aliases: ["gps", "navstar 66"]
                        },
                        {
                                id: "GALILEO-5",
                                name: "GALILEO-5",
                                noradId: 40128,
                                aliases: ["galileo", "gsat0201"]
                        },
                        {
                                id: "GALILEO-6",
                                name: "GALILEO-6",
                                noradId: 40129,
                                aliases: ["galileo", "gsat0202"]
                        },
                        {
                                id: "GLONASS-M-2433",
                                name: "GLONASS-M 2433",
                                noradId: 32275,
                                aliases: ["glonass", "cosmos 2433"]
                        },
                        {
                                id: "BEIDOU-3-M1",
                                name: "BEIDOU-3 M1",
                                noradId: 43001,
                                aliases: ["beidou", "compass"]
                        },
                        {
                                id: "QZS-1R",
                                name: "QZS-1R",
                                noradId: 49336,
                                aliases: ["qzss", "michibiki"]
                        }
                ]
        },
        {
                id: "amateur",
                label: "amateur radio",
                satellites: [
                        {
                                id: "AO-73",
                                name: "FUNCUBE-1 (AO-73)",
                                noradId: 39444,
                                aliases: ["ao73", "funcube", "amsat"]
                        },
                        {
                                id: "AO-91",
                                name: "AO-91 (FOX-1B)",
                                noradId: 43017,
                                aliases: ["ao91", "fox 1b", "radfxsat"]
                        },
                        {
                                id: "SO-50",
                                name: "SO-50",
                                noradId: 27607,
                                aliases: ["so50", "saudisat 1c"]
                        }
                ]
        },
        {
                id: "comms",
                label: "comms",
                satellites: [
                        { id: "IRIDIUM-103", name: "IRIDIUM 103", noradId: 41918 },
                        { id: "IRIDIUM-106", name: "IRIDIUM 106", noradId: 41917 },
                        { id: "IRIDIUM-109", name: "IRIDIUM 109", noradId: 41919 }
                ]
        }
];

const expand = (group) => group.satellites.map((satellite) => {
        const keys = [
                satellite.id,
                satellite.name,
                satellite.noradId,
                ...(satellite.aliases || [])
        ].map(normalize);

        return {
                id: satellite.id,
                name: satellite.name,
                noradId: satellite.noradId,
                group: group.label,
                keys,
                search: [...keys, normalize(group.label)].join(" ")
        };
});

export const SATELLITE_GROUPS = GROUPS.map((group) => ({
        id: group.id,
        label: group.label,
        satellites: expand(group)
}));

export const SATELLITES = SATELLITE_GROUPS.flatMap((group) => group.satellites);

export function findSatellite(query) {
        if (query === null || query === undefined) return null;

        const wanted = normalize(query);
        if (!wanted) return null;

        return SATELLITES.find((satellite) => satellite.keys.includes(wanted)) || null;
}

export const DEFAULT_SATELLITE = findSatellite("ISS");

const PROVIDERS = [
        {
                id: "celestrak",
                url: (noradId) => `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=TLE`,
                parse(text) {
                        const lines = text
                                .split(/\r?\n/)
                                .map((line) => line.trimEnd())
                                .filter((line) => line.trim().length > 0);
                        const index = lines.findIndex((line) => line.startsWith("1 "));
                        const line1 = index >= 0 ? lines[index] : "";
                        const line2 = index >= 0 ? lines[index + 1] || "" : "";

                        if (!line1 || !line2.startsWith("2 ")) {
                                throw new Error("the TLE service returned no usable data");
                        }

                        return [line1, line2];
                }
        },
        {
                id: "tle-api",
                url: (noradId) => `https://tle.ivanstanojevic.me/api/tle/${noradId}`,
                parse(text) {
                        const data = JSON.parse(text);

                        if (typeof data?.line1 !== "string" || typeof data?.line2 !== "string") {
                                throw new Error("the backup TLE service returned no usable data");
                        }

                        return [data.line1, data.line2];
                }
        }
];

function storageKey(noradId) {
        return `${STORAGE_PREFIX}${noradId}`;
}

function readStoredTle(noradId) {
        try {
                const raw = window.localStorage.getItem(storageKey(noradId));
                if (!raw) return null;

                const data = JSON.parse(raw);

                if (!Array.isArray(data?.tle) || data.tle.length !== 2) return null;

                return { tle: data.tle, fetchedAt: Number(data.fetchedAt) || 0 };
        } catch {
                return null;
        }
}

function writeStoredTle(noradId, tle) {
        try {
                window.localStorage.setItem(storageKey(noradId), JSON.stringify({
                        tle,
                        fetchedAt: Date.now()
                }));
        } catch {
                // Storage can be unavailable or full; the in-memory cache still works.
        }
}

async function requestText(url, outerSignal) {
        const controller = new AbortController();
        let timedOut = false;
        const timeout = window.setTimeout(() => {
                timedOut = true;
                controller.abort();
        }, REQUEST_TIMEOUT_MS);
        const forwardAbort = () => controller.abort();

        if (outerSignal) {
                if (outerSignal.aborted) {
                        window.clearTimeout(timeout);
                        throw new DOMException("Aborted", "AbortError");
                }
                outerSignal.addEventListener("abort", forwardAbort, { once: true });
        }

        try {
                const response = await fetch(url, {
                        signal: controller.signal,
                        cache: "no-store"
                });

                if (!response.ok) {
                        throw new Error(`the TLE service returned HTTP ${response.status}`);
                }

                return await response.text();
        } catch (error) {
                if (timedOut) throw new Error("the TLE request timed out");
                if (outerSignal?.aborted) throw new DOMException("Aborted", "AbortError");
                throw error;
        } finally {
                window.clearTimeout(timeout);
                outerSignal?.removeEventListener("abort", forwardAbort);
        }
}

/**
 * Fetch a current two-line element set for a catalog entry.
 *
 * Fresh in-memory results are reused for ten minutes. Otherwise Celestrak is
 * tried first, then a backup API. If both are unreachable, the last TLE cached
 * in localStorage is used so an already-visited satellite still works offline.
 */
export async function fetchSatelliteTle(entry, { force = false, signal } = {}) {
        const noradId = entry.noradId;
        const memo = memoryCache.get(noradId);

        if (!force && memo && Date.now() - memo.fetchedAt < MEMORY_TTL_MS) {
                return { tle: memo.tle.slice(), fetchedAt: memo.fetchedAt, source: "live" };
        }

        let failure = null;

        for (const provider of PROVIDERS) {
                try {
                        const text = await requestText(provider.url(noradId), signal);
                        const tle = provider.parse(text);
                        const fetchedAt = Date.now();

                        memoryCache.set(noradId, { tle, fetchedAt });
                        writeStoredTle(noradId, tle);

                        return { tle, fetchedAt, source: "live", provider: provider.id };
                } catch (error) {
                        if (error?.name === "AbortError") throw error;
                        failure = error;
                }
        }

        const stored = readStoredTle(noradId);

        if (stored) {
                return { tle: stored.tle, fetchedAt: stored.fetchedAt, source: "cache" };
        }

        const detail = failure?.message || "";

        throw new Error(/^the TLE service returned HTTP \d+$/.test(detail)
                ? detail
                : "no current TLE could be fetched");
}

/** Decode the TLE epoch (columns 19-32 of line 1) into a Date. */
export function tleEpoch(tle) {
        const line1 = tle?.[0];

        if (typeof line1 !== "string" || line1.length < 32) return null;

        const shortYear = Number(line1.slice(18, 20));
        const day = Number(line1.slice(20, 32));

        if (!Number.isInteger(shortYear) || !Number.isFinite(day) || day < 1) return null;

        const year = shortYear < 57 ? 2000 + shortYear : 1900 + shortYear;
        const epoch = new Date(Date.UTC(year, 0, 1) + (day - 1) * 86_400_000);

        return Number.isFinite(epoch.getTime()) ? epoch : null;
}
