(function () {
	"use strict";

	const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp"];
	const PRIORITY_SCAN_LIMIT = 4;
	const AUTOPLAY_INTERVAL_MS = 4000;
	const AUTOPLAY_STAGGER_MIN_MS = 0;
	const AUTOPLAY_STAGGER_MAX_MS = 1000;

	// ---------- project CSV parsing ----------
	function parseCSV(text) {
		// Strip BOM
		if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

		const rows = [];
		let row = [];
		let field = "";
		let inQuotes = false;

		for (let i = 0; i < text.length; i++) {
			const c = text[i];

			if (inQuotes) {
				if (c === '"') {
					if (text[i + 1] === '"') {
						field += '"';
						i++;
					} else inQuotes = false;
				} else {
					field += c;
				}
			} else {
				if (c === '"') {
					inQuotes = true;
				} else if (c === ",") {
					row.push(field);
					field = "";
				} else if (c === "\n" || c === "\r") {
					// finalize row; skip \r\n pair
					row.push(field);
					field = "";
					rows.push(row);
					row = [];
					if (c === "\r" && text[i + 1] === "\n") i++;
				} else {
					field += c;
				}
			}
		}
		// final field/row
		if (field.length > 0 || row.length > 0) {
			row.push(field);
			rows.push(row);
		}

		if (rows.length === 0) return [];
		const headers = rows[0].map((h) => h.trim());
		const records = [];
		for (let r = 1; r < rows.length; r++) {
			const cols = rows[r];
			// skip blank lines
			if (cols.length === 1 && cols[0].trim() === "") continue;
			const obj = {};
			for (let h = 0; h < headers.length; h++) {
				obj[headers[h]] = (cols[h] ?? "").trim();
			}
			records.push(obj);
		}
		return records;
	}

	function isTruthy(v) {
		return /^(true|1|yes|y)$/i.test(String(v).trim());
	}

	function pad2(n) {
		return String(n).padStart(2, "0");
	}

	// ---------- image discovery ----------
	function probeImage(src) {
		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => resolve(true);
			img.onerror = () => resolve(false);
			img.src = src;
		});
	}

	function candidatesForRange(folder, startIndex, endIndex) {
		const candidates = [];
		for (let i = startIndex; i <= endIndex; i++) {
			const suffix = pad2(i);
			for (const ext of IMAGE_EXTENSIONS) {
				candidates.push({
					index: i,
					src: `img/${folder}/${folder}_${suffix}.${ext}`,
				});
			}
		}
		return candidates;
	}

	async function resolveHits(candidates) {
		const hits = await Promise.all(
			candidates.map((c) => probeImage(c.src)),
		);

		const byIndex = new Map();
		candidates.forEach((c, i) => {
			if (hits[i] && !byIndex.has(c.index)) byIndex.set(c.index, c.src);
		});

		return [...byIndex.keys()]
			.sort((a, b) => a - b)
			.map((i) => byIndex.get(i));
	}

	// Fast scan of the first few indices so tiles can render before the full scan finishes
	async function discoverLeadImages(folder) {
		if (!folder) return [];
		return resolveHits(
			candidatesForRange(folder, 0, PRIORITY_SCAN_LIMIT - 1),
		);
	}

	async function discoverImages(folder, numImages) {
		if (!folder) return [];
		return resolveHits(candidatesForRange(folder, 1, Number(numImages)));
	}

	// ---------- carousel behavior ----------
	function initCarousel(media, count, { onChange } = {}) {
		const slides = media.querySelectorAll(".project__slide");
		let current = 0;
		let zCounter = 1;
		slides[0].style.zIndex = String(zCounter);
		let timer = null;

		function goTo(next) {
			const wrapped = ((next % count) + count) % count;
			if (wrapped === current) return;

			const outgoing = slides[current];
			const incoming = slides[wrapped];

			// crossfade between images
			zCounter += 1;
			incoming.style.zIndex = String(zCounter);
			incoming.classList.add("is-active");
			incoming.addEventListener(
				"transitionend",
				() => outgoing.classList.remove("is-active"),
				{ once: true },
			);

			current = wrapped;
			if (onChange) onChange(current);
		}

		function scheduleAutoplay() {
			const delay = AUTOPLAY_INTERVAL_MS +
				AUTOPLAY_STAGGER_MIN_MS +
				Math.random() *
					(AUTOPLAY_STAGGER_MAX_MS - AUTOPLAY_STAGGER_MIN_MS);
			timer = setTimeout(() => {
				goTo(current + 1);
				scheduleAutoplay();
			}, delay);
		}

		function restartAutoplay() {
			if (timer) clearTimeout(timer);
			scheduleAutoplay();
		}

		function isLeftHalf(event) {
			const rect = media.getBoundingClientRect();
			return event.clientX - rect.left < rect.width / 2;
		}

		media.addEventListener("click", (event) => {
			goTo(isLeftHalf(event) ? current - 1 : current + 1);
			restartAutoplay();
		});

		media.addEventListener("mousemove", (event) => {
			document.body.style.cursor = isLeftHalf(event)
				? "w-resize"
				: "e-resize";
		});

		media.addEventListener("mouseleave", () => {
			document.body.style.cursor = "auto";
		});

		restartAutoplay();

		return {
			goTo(index) {
				goTo(index);
				restartAutoplay();
			},
		};
	}

	// ---------- dot indicators ----------
	function renderDots(dotsEl, count, activeIndex, onSelect) {
		dotsEl.innerHTML = "";
		for (let i = 0; i < count; i++) {
			const dot = document.createElement("button");
			dot.type = "button";
			dot.className = "project__dot" +
				(i === activeIndex ? " is-active" : "");
			dot.setAttribute("aria-label", `Show image ${i + 1} of ${count}`);
			dot.addEventListener("click", () => onSelect(i));
			dotsEl.appendChild(dot);
		}
	}

	function setActiveDot(dotsEl, activeIndex) {
		[...dotsEl.children].forEach((dot, i) => {
			dot.classList.toggle("is-active", i === activeIndex);
		});
	}

	// ---------- tile rendering ----------
	function createSlide(src, alt, { active, eager }) {
		const img = document.createElement("img");
		img.className = "project__slide" + (active ? " is-active" : "");
		img.src = src;
		img.alt = alt;
		img.loading = eager ? "eager" : "lazy";
		img.decoding = "async";
		img.draggable = false;
		return img;
	}

	function buildProject(row, leadImages) {
		const article = document.createElement("article");
		article.className = "project";

		if (leadImages.length) {
			const media = document.createElement("div");
			media.className = "project__media";
			const alt = row.alt_text || row.name || "";
			leadImages.forEach((src, i) => {
				media.appendChild(
					createSlide(src, alt, { active: i === 0, eager: i === 0 }),
				);
			});
			article.appendChild(media);
		}

		if (row.name) {
			const meta = document.createElement("div");
			meta.className = "project__meta";

			const title = document.createElement("p");
			title.className = "info project__title";
			title.textContent = row.name;
			meta.appendChild(title);

			if (row.folder) {
				const dots = document.createElement("div");
				dots.className = "project__dots";
				meta.appendChild(dots);
			}

			article.appendChild(meta);
		}

		const caption = document.createElement("p");
		caption.className = "info project__caption";
		caption.textContent = row.caption || "";
		if (row.credit) {
			const credit = document.createElement("span");
			credit.className = "project__credit";
			credit.textContent = ` with ${row.credit}`;
			caption.appendChild(credit);
		}
		article.appendChild(caption);

		return article;
	}

	// Fills in the rest of a project's carousel once the full scan resolves
	function completeCarousel(article, row, images) {
		if (!images.length) return;

		let media = article.querySelector(".project__media");
		const isNewMedia = !media;
		if (isNewMedia) {
			media = document.createElement("div");
			media.className = "project__media";
			article.insertBefore(media, article.firstChild);
		}

		const alt = row.alt_text || row.name || "";
		const existingSrcs = new Set(
			[...media.querySelectorAll(".project__slide")].map((img) =>
				img.src
			),
		);

		images.forEach((src) => {
			const absoluteSrc = new URL(src, window.location.href).href;
			if (existingSrcs.has(absoluteSrc)) return;
			const isFirstOfNewMedia = isNewMedia && media.children.length === 0;
			media.appendChild(
				createSlide(src, alt, {
					active: isFirstOfNewMedia,
					eager: isFirstOfNewMedia,
				}),
			);
		});

		const slides = media.querySelectorAll(".project__slide");
		if (slides.length > 1) {
			const dotsEl = article.querySelector(".project__dots");
			const carousel = initCarousel(media, slides.length, {
				onChange: (index) => {
					if (dotsEl) setActiveDot(dotsEl, index);
				},
			});
			if (dotsEl) {
				renderDots(
					dotsEl,
					slides.length,
					0,
					(index) => carousel.goTo(index),
				);
			}
		}
	}

	// ---------- load + render ----------
	async function loadProjects() {
		const grid = document.getElementById("project-grid");
		if (!grid) return;

		let text;
		try {
			const res = await fetch("data/project_directory.csv", {
				cache: "no-cache",
			});
			if (!res.ok) throw new Error("HTTP " + res.status);
			text = await res.text();
		} catch (err) {
			console.error("Could not load project_directory.csv:", err);
			return;
		}

		const rows = parseCSV(text)
			.filter((r) => isTruthy(r.publish))
			.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

		// Render every tile with just its lead image so the grid appears fast
		const tiles = await Promise.all(
			rows.map(async (row) => {
				const leadImages = await discoverLeadImages(row.folder);
				return { row, article: buildProject(row, leadImages) };
			}),
		);

		const frag = document.createDocumentFragment();
		tiles.forEach(({ article }) => frag.appendChild(article));
		grid.appendChild(frag);

		// Fill in the rest of each carousel in the background per project
		tiles.forEach(({ row, article }) => {
			if (!row.folder) return;
			discoverImages(row.folder, row.num_images).then((images) =>
				completeCarousel(article, row, images)
			);
		});
	}

	// ---------- boot ----------
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", loadProjects);
	} else {
		loadProjects();
	}
})();
