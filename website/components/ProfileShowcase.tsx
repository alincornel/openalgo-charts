import React from 'react';
import Link from 'next/link';

const ROOT = '/openalgo-charts';
const IMAGE_ROOT = `${ROOT}/screenshots/market-profile`;
const DEMO = `${ROOT}/demos/market-profile/index.html`;
const THEMES = [
  { id: 'dark', name: 'Dark', description: 'Multicolour periods on a dark background.' },
  { id: 'blue', name: 'Blue', description: 'Navy background, purple letters and cyan volume.' },
  { id: 'graphite', name: 'Graphite', description: 'Charcoal, pale letters and muted cyan volume.' },
  { id: 'emerald', name: 'Emerald', description: 'Deep green, mint letters and gold reference lines.' },
  { id: 'ivory', name: 'Ivory', description: 'Warm light background, dark letters and blue-grey volume.' },
];

export function ProfileDemo() {
  return (
    <div className="oac-profile-demo">
      <div className="oac-profile-demo__head">
        <span>Six synthetic sessions · 2-point rows</span>
        <a href={`${DEMO}?theme=blue`} target="_blank" rel="noreferrer">Open full-size demo ↗</a>
      </div>
      <iframe src={`${DEMO}?theme=blue`} title="Interactive compact market profile demo" loading="lazy" />
    </div>
  );
}

export function ProfileThemeGallery() {
  return (
    <div className="oac-profile-gallery">
      {THEMES.map(theme => (
        <figure className="oac-profile-shot" key={theme.id}>
          <a href={`${IMAGE_ROOT}/${theme.id}.png`} target="_blank" rel="noreferrer" aria-label={`View full-resolution ${theme.name} screenshot`}>
            <img src={`${IMAGE_ROOT}/${theme.id}.png`} alt={`${theme.name} compact TPO profiles, volume values, open and latest-price markers; the newest session is split`} width={1600} height={1000} loading="lazy" />
          </a>
          <figcaption>
            <strong>{theme.name}</strong>
            <p>{theme.description}</p>
            <a href={`${DEMO}?theme=${theme.id}`} target="_blank" rel="noreferrer">Try {theme.name} ↗</a>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function ProfileSplitScreenshots() {
  return (
    <div className="oac-profile-details">
      {['packed', 'split'].map(mode => (
        <figure className="oac-profile-shot" key={mode}>
          <a href={`${IMAGE_ROOT}/${mode}-detail.png`} target="_blank" rel="noreferrer">
            <img src={`${IMAGE_ROOT}/${mode}-detail.png`} alt={`${mode === 'packed' ? 'Packed' : 'Split'} view of the same daily TPO profile, with lowercase o at the open and # at the latest price`} loading="lazy" />
          </a>
          <figcaption><strong>{mode === 'packed' ? 'Packed: gaps closed' : 'Split: one column per period'}</strong></figcaption>
        </figure>
      ))}
    </div>
  );
}

export function ProfilePreview() {
  return (
    <section className="oac-section oac-profile-preview">
      <div>
        <span className="oac-pill">2.1.0</span>
        <h2>Compact market profiles, in five themes.</h2>
        <p>Read small TPO letters, split one day with a right-click, and follow the opening and latest-price markers. Explore dark and light palettes with the same data.</p>
        <Link className="oac-btn oac-btn--primary" href="/docs/market-profile-examples">Explore the profile demo</Link>
      </div>
      <Link href="/docs/market-profile-examples">
        <img src={`${IMAGE_ROOT}/blue.png`} alt="Blue theme with six compact daily market profiles and the newest session split" width={1600} height={1000} loading="lazy" />
      </Link>
    </section>
  );
}
