// Shared ASCII/block glyphs and text rendering for the map and inclination globe.
export const BLOCKS = {
        light: "░",
        medium: "▒",
        dark: "▓",
        solid: "█"
};

export const BLOCK_RAMP = Object.values(BLOCKS).join("");

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

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const span = (text, style) => (style ? `<span class="${style}">${text}</span>` : text);

export function asciiToHtml(chars, columns, rows, styles) {
        let html = "";

        for (let row = 0; row < rows; row += 1) {
                let run = "";
                let style = null;
                const end = (row + 1) * columns;

                for (let index = row * columns; index < end; index += 1) {
                        const nextStyle = styles[index] || null;

                        if (nextStyle !== style) {
                                html += span(run, style);
                                run = "";
                                style = nextStyle;
                        }

                        const character = chars[index];
                        run += ESCAPES[character] || character;
                }

                html += span(run, style);
                if (row < rows - 1) html += "\n";
        }

        return html;
}

export function hasActiveSelection(element) {
        try {
                const selection = window.getSelection();
                return Boolean(
                        selection
                        && !selection.isCollapsed
                        && selection.rangeCount
                        && selection.getRangeAt(0).intersectsNode(element)
                );
        } catch {
                return false;
        }
}
