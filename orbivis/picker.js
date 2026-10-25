// ASCII-styled satellite picker: a filterable listbox with keyboard support.
//
// The markup lives in index.html so the control is usable before this module
// runs. This module fills the list, handles filtering/navigation, and reports
// the chosen catalog entry through onSelect.

const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
const OPTION_ID_PREFIX = "ov-satellite-option-";

export function createSatellitePicker({ root, groups, onSelect }) {
        const button = root.querySelector(".ov-select-button");
        const value = root.querySelector(".ov-select-value");
        const caret = root.querySelector(".ov-select-caret");
        const popup = root.querySelector(".ov-select-popup");
        const filter = root.querySelector(".ov-select-filter input");
        const list = root.querySelector(".ov-select-list");
        const count = root.querySelector(".ov-select-count");
        const total = groups.reduce((sum, group) => sum + group.satellites.length, 0);
        const byId = new Map(
                groups.flatMap((group) => group.satellites.map((satellite) => [satellite.id, satellite]))
        );

        let selected = null;
        let open = false;
        let loading = false;
        let activeIndex = -1;
        let options = [];

        function updateCaret() {
                caret.textContent = loading ? "*" : open ? "^" : "v";
        }

        function updateButton() {
                value.textContent = selected ? selected.name : "select satellite";
                button.setAttribute("aria-label", selected ? `Satellite: ${selected.name}` : "Choose a satellite");
        }

        function updateMarks() {
                options.forEach((option, index) => {
                        const isSelected = Boolean(selected && option.dataset.satellite === selected.id);
                        const mark = option.querySelector(".ov-select-mark");

                        mark.textContent = index === activeIndex ? ">" : isSelected ? "*" : " ";
                        option.setAttribute("aria-selected", String(isSelected));
                });
        }

        function setActive(index, { scroll = false } = {}) {
                if (!options.length) {
                        activeIndex = -1;
                        filter.removeAttribute("aria-activedescendant");
                        updateMarks();
                        return;
                }

                activeIndex = Math.min(options.length - 1, Math.max(0, index));
                filter.setAttribute("aria-activedescendant", options[activeIndex].id);
                options.forEach((option, optionIndex) => {
                        option.classList.toggle("is-active", optionIndex === activeIndex);
                });
                updateMarks();

                if (scroll) options[activeIndex].scrollIntoView({ block: "nearest" });
        }

        function moveActive(step) {
                if (!options.length) return;

                const next = activeIndex < 0
                        ? (step > 0 ? 0 : options.length - 1)
                        : (activeIndex + step + options.length) % options.length;

                setActive(next, { scroll: true });
        }

        function renderOptions() {
                const query = normalize(filter.value);
                const fragment = document.createDocumentFragment();
                let matches = 0;

                options = [];

                for (const group of groups) {
                        const hits = group.satellites.filter(
                                (satellite) => !query || satellite.search.includes(query)
                        );

                        if (!hits.length) continue;

                        const heading = document.createElement("p");
                        heading.className = "ov-select-group";
                        heading.setAttribute("role", "presentation");
                        heading.textContent = `// ${group.label}`;
                        fragment.append(heading);

                        for (const satellite of hits) {
                                const option = document.createElement("div");
                                option.className = "ov-select-option";
                                option.id = `${OPTION_ID_PREFIX}${options.length}`;
                                option.dataset.satellite = satellite.id;
                                option.setAttribute("role", "option");
                                option.setAttribute("aria-selected", "false");

                                const mark = document.createElement("span");
                                mark.className = "ov-select-mark";
                                mark.setAttribute("aria-hidden", "true");

                                const name = document.createElement("span");
                                name.className = "ov-select-name";
                                name.textContent = satellite.name;

                                const norad = document.createElement("span");
                                norad.className = "ov-select-id";
                                norad.setAttribute("aria-hidden", "true");
                                norad.textContent = String(satellite.noradId);

                                option.append(mark, name, norad);
                                fragment.append(option);
                                options.push(option);
                                matches += 1;
                        }
                }

                if (!matches) {
                        const empty = document.createElement("p");
                        empty.className = "ov-select-empty";
                        empty.setAttribute("role", "presentation");
                        empty.textContent = "no matching satellites";
                        fragment.append(empty);
                }

                list.replaceChildren(fragment);
                count.textContent = query ? `${matches}/${total}` : String(total);
                activeIndex = -1;
                updateMarks();

                if (options.length) {
                        const selectedIndex = options.findIndex(
                                (option) => selected && option.dataset.satellite === selected.id
                        );
                        setActive(selectedIndex >= 0 ? selectedIndex : 0, { scroll: true });
                }
        }

        function openPicker() {
                if (open) return;

                open = true;
                filter.value = "";
                popup.hidden = false;
                root.classList.add("is-open");
                button.setAttribute("aria-expanded", "true");
                filter.setAttribute("aria-expanded", "true");
                updateCaret();
                renderOptions();
                filter.focus();
        }

        function closePicker({ focusButton = false } = {}) {
                if (!open) return;

                open = false;
                popup.hidden = true;
                root.classList.remove("is-open");
                button.setAttribute("aria-expanded", "false");
                filter.setAttribute("aria-expanded", "false");
                filter.removeAttribute("aria-activedescendant");
                activeIndex = -1;
                updateCaret();

                if (focusButton) button.focus();
        }

        function choose(option) {
                const satellite = byId.get(option.dataset.satellite);
                if (!satellite) return;

                setSelected(satellite);
                closePicker({ focusButton: true });
                onSelect(satellite);
        }

        function setSelected(satellite) {
                selected = satellite || null;
                updateButton();
                if (open) updateMarks();
        }

        function setLoading(next) {
                loading = Boolean(next);
                root.classList.toggle("is-loading", loading);

                if (loading) {
                        button.setAttribute("aria-busy", "true");
                } else {
                        button.removeAttribute("aria-busy");
                }

                updateCaret();
        }

        button.addEventListener("click", () => {
                if (open) {
                        closePicker({ focusButton: true });
                } else {
                        openPicker();
                }
        });

        button.addEventListener("keydown", (event) => {
                if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                        event.preventDefault();
                        openPicker();
                }
        });

        filter.addEventListener("input", renderOptions);

        filter.addEventListener("keydown", (event) => {
                switch (event.key) {
                        case "ArrowDown":
                                event.preventDefault();
                                moveActive(1);
                                break;
                        case "ArrowUp":
                                event.preventDefault();
                                moveActive(-1);
                                break;
                        case "Home":
                                event.preventDefault();
                                setActive(0, { scroll: true });
                                break;
                        case "End":
                                event.preventDefault();
                                setActive(options.length - 1, { scroll: true });
                                break;
                        case "PageDown":
                                event.preventDefault();
                                setActive(activeIndex + 8, { scroll: true });
                                break;
                        case "PageUp":
                                event.preventDefault();
                                setActive(activeIndex - 8, { scroll: true });
                                break;
                        case "Enter":
                                if (activeIndex >= 0 && options[activeIndex]) {
                                        event.preventDefault();
                                        choose(options[activeIndex]);
                                }
                                break;
                        case "Escape":
                                event.preventDefault();
                                closePicker({ focusButton: true });
                                break;
                        case "Tab":
                                closePicker();
                                break;
                        default:
                                break;
                }
        });

        list.addEventListener("pointerdown", (event) => {
                if (event.target.closest(".ov-select-option")) event.preventDefault();
        });

        list.addEventListener("pointermove", (event) => {
                const option = event.target.closest(".ov-select-option");
                if (!option) return;

                const index = options.indexOf(option);
                if (index >= 0 && index !== activeIndex) setActive(index);
        });

        list.addEventListener("click", (event) => {
                const option = event.target.closest(".ov-select-option");
                if (option) choose(option);
        });

        root.addEventListener("focusout", (event) => {
                if (!open) return;
                if (event.relatedTarget && root.contains(event.relatedTarget)) return;

                closePicker();
        });

        document.addEventListener("pointerdown", (event) => {
                if (open && !root.contains(event.target)) closePicker();
        });

        updateCaret();

        return {
                close: () => closePicker(),
                open: openPicker,
                setLoading,
                setSelected
        };
}
