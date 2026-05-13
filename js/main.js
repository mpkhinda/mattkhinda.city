
(function () {
	'use strict';

	// ---------- bio toggle ----------
	function initBioToggle() {
		const toggle = document.querySelector('.bio__toggle');
		const more   = document.querySelector('.bio__more');
		const label  = document.querySelector('.bio__toggle-label');
		const moreText = document.querySelector('.bio__more-text');
		if (!toggle || !more || !label) return;

		// If no extended bio, hide toggle
		if (!moreText || moreText.textContent.trim() === '') {
			toggle.hidden = true;
			return;
		}

		toggle.addEventListener('click', () => {
			const expanded = toggle.getAttribute('aria-expanded') === 'true';
			toggle.setAttribute('aria-expanded', String(!expanded));
			more.hidden = expanded;
			label.textContent = expanded ? 'Read more' : 'Read less';
		});
	}

	// ---------- project CSV parsing ----------
	function parseCSV(text) {
		// Strip BOM
		if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

		const rows = [];
		let row = [];
		let field = '';
		let inQuotes = false;

		for (let i = 0; i < text.length; i++) {
			const c = text[i];

			if (inQuotes) {
				if (c === '"') {
					if (text[i + 1] === '"') { field += '"'; i++; }
					else { inQuotes = false; }
				} else {
					field += c;
				}
			} else {
				if (c === '"') {
					inQuotes = true;
				} else if (c === ',') {
					row.push(field); field = '';
				} else if (c === '\n' || c === '\r') {
					// finalize row; skip \r\n pair
					row.push(field); field = '';
					rows.push(row); row = [];
					if (c === '\r' && text[i + 1] === '\n') i++;
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
		const headers = rows[0].map(h => h.trim());
		const records = [];
		for (let r = 1; r < rows.length; r++) {
			const cols = rows[r];
			// skip blank lines
			if (cols.length === 1 && cols[0].trim() === '') continue;
			const obj = {};
			for (let h = 0; h < headers.length; h++) {
				obj[headers[h]] = (cols[h] ?? '').trim();
			}
			records.push(obj);
		}
		return records;
	}

	// ---------- tile rendering ----------
	function isTruthy(v) {
		return /^(true|1|yes|y)$/i.test(String(v).trim());
	}

	function descriptionHTML(text) {
		if (!text) return '';
		const esc = (s) => s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');

		const parts = [];
		const re = /[\u201C]([^\u201D]+)[\u201D]/g;
		let last = 0, m;
		while ((m = re.exec(text)) !== null) {
			if (m.index > last) parts.push(esc(text.slice(last, m.index)));
			parts.push('<em>\u201C' + esc(m[1]) + '\u201D</em>');
			last = re.lastIndex;
		}
		if (last < text.length) parts.push(esc(text.slice(last)));
		return parts.join('');
	}

	function buildTile(p) {
		const tile = document.createElement('article');
		tile.className = 'tile';

		// --- body (left column) ---
		const body = document.createElement('div');
		body.className = 'tile__body';

		if (p.emojis) {
            const e = document.createElement('div');
            e.className = 'tile__emojis';
            e.setAttribute('aria-hidden', 'true');
            e.textContent = p.emojis.replace(/\s+/g, '\u2009');
            body.appendChild(e);
}

		const h = document.createElement('h2');
		h.className = 'tile__title';
		h.textContent = p.name || '';
		body.appendChild(h);

		if (p.tags) {
			const t = document.createElement('p');
			t.className = 'tile__tags';
			t.textContent = p.tags.replace(/\s*\|\s*/g, ', ');
			body.appendChild(t);
		}

		if (p.description) {
			const d = document.createElement('p');
			d.className = 'tile__desc';
			d.innerHTML = descriptionHTML(p.description);
			body.appendChild(d);
		}

		if (p.link_text && p.link_destination) {
			const a = document.createElement('a');
			a.className = 'tile__link';
			a.href = p.link_destination;
			a.target = '_blank';
			a.rel = 'noopener noreferrer';
			a.innerHTML = `<span class="tile__link-text">${escapeHTML(p.link_text)}</span> <span class="tile__link-arrow" aria-hidden="true">↗</span>`;
			body.appendChild(a);
		}

		tile.appendChild(body);

		// --- media (right column) ---
		if (p.image) {
			const media = document.createElement('div');
			media.className = 'tile__media';
			const img = document.createElement('img');
			img.src = 'img/' + p.image;
			img.alt = p.alt_text || '';
			img.loading = 'eager';
			img.decoding = 'async';
			media.appendChild(img);
			tile.appendChild(media);
		} else {
			// keep grid alignment with an empty cell
			const spacer = document.createElement('div');
			spacer.className = 'tile__media';
			spacer.setAttribute('aria-hidden', 'true');
			spacer.style.background = 'transparent';
			tile.appendChild(spacer);
		}

		return tile;
	}

	function escapeHTML(s) {
		return String(s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	// ---------- load + render ----------
	async function loadProjects() {
		const grid = document.getElementById('project-grid');
		if (!grid) return;

		let text;
		try {
			const res = await fetch('data/project_directory.csv', { cache: 'no-cache' });
			if (!res.ok) throw new Error('HTTP ' + res.status);
			text = await res.text();
		} catch (err) {
			console.error('Could not load project_directory.csv:', err);
			return;
		}

		const records = parseCSV(text)
			.filter(r => isTruthy(r.publish))
			.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

		const frag = document.createDocumentFragment();
		records.forEach(r => frag.appendChild(buildTile(r)));
		grid.appendChild(frag);
	}

	// ---------- boot ----------
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', () => {
			initBioToggle();
			loadProjects();
		});
	} else {
		initBioToggle();
		loadProjects();
	}
})();