// Shared ASCII/block glyphs and text rendering for the map and inclination globe.
export const BLOCKS = {
        light: "░",
        medium: "▒",
        dark: "▓",
        solid: "█"
};

export const BLOCK_RAMP = `${BLOCKS.light}${BLOCKS.medium}${BLOCKS.dark}${BLOCKS.solid}`;

export const ASCII = {
        land: "#",
        coast: "+",
        graticule: ".",
        orbitPast: ",",
        orbitFuture: "*",
        range: ":",
        groundStation: "X",
        satellite: "@"
};

const HTML_ESCAPES = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;"
};

export function asciiToHtml(chars, columns, rows, styles) {
        const parts = [];

        for (let row = 0; row < rows; row += 1) {
                let run = "";
                let runStyle = null;
                const start = row * columns;
                const end = start + columns;

                for (let index = start; index < end; index += 1) {
                        const style = styles[index] || null;

                        if (style !== runStyle) {
                                if (run) parts.push(wrapRun(run, runStyle));
                                run = "";
                                runStyle = style;
                        }

                        const character = chars[index];
                        run += HTML_ESCAPES[character] || character;
                }

                if (run) parts.push(wrapRun(run, runStyle));
                if (row < rows - 1) parts.push("\n");
        }

        return parts.join("");
}

function wrapRun(text, style) {
        return style ? `<span class="${style}">${text}</span>` : text;
}

export function hasActiveSelection(element) {
        const selection = window.getSelection();

        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
                return false;
        }

        try {
                return selection.getRangeAt(0).intersectsNode(element);
        } catch {
                return false;
        }
}
