// A caption bar at the bottom of the page, baked into the recording: the
// test says what the viewer is looking at, in the page itself, so no video
// editor has to. Survives a navigation (sessionStorage + an init script);
// `forgetThisDevice` clears it, as it clears everything.

const STYLE = {
	position: 'fixed',
	left: '0',
	right: '0',
	bottom: '0',
	padding: '16px 28px',
	background: 'rgba(17, 24, 39, 0.86)',
	color: '#fff',
	font: '600 22px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif',
	letterSpacing: '0.01em',
	zIndex: '2147483647',
	pointerEvents: 'none',
	textAlign: 'center'
};

/** @param {import('@playwright/test').BrowserContext} context */
export async function installCaptions(context) {
	await context.addInitScript((style) => {
		const render = () => {
			const text = sessionStorage.getItem('demo.caption');
			if (!text || !document.body) return;
			document.body.style.paddingBottom = '96px';
			let bar = document.getElementById('demo-caption');
			if (!bar) {
				bar = document.createElement('div');
				bar.id = 'demo-caption';
				Object.assign(bar.style, style);
				document.body.appendChild(bar);
			}
			bar.textContent = text;
		};
		document.addEventListener('DOMContentLoaded', render);
	}, STYLE);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 * @param {number} [hold] ms to let the viewer read it before the next step
 */
export async function say(page, text, hold = 1800) {
	await page.evaluate(
		({ text, style }) => {
			sessionStorage.setItem('demo.caption', text);
			document.body.style.paddingBottom = '96px';
			let bar = document.getElementById('demo-caption');
			if (!bar) {
				bar = document.createElement('div');
				bar.id = 'demo-caption';
				Object.assign(bar.style, style);
				document.body.appendChild(bar);
			}
			bar.textContent = text;
		},
		{ text, style: STYLE }
	);
	await page.waitForTimeout(hold);
}
