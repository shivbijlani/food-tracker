import { BRAND } from './branding.js'

const REPO_URL = 'https://github.com/shivbijlani/food-tracker'

/**
 * App footer with copyright, ownership, privacy note, and useful links.
 * Kept legalistic-light: this is a personal/free tool, not a SaaS.
 */
export function Footer({ installButton = null }) {
  const year = new Date().getFullYear()
  return (
    <footer className="app-footer">
      <div className="app-footer-row">
        <span>© {year} {BRAND.name}</span>
        <span aria-hidden="true">·</span>
        <span>Your data stays in your browser and your own cloud — we never see it.</span>
      </div>
      <div className="app-footer-row app-footer-links">
        <a href={REPO_URL} target="_blank" rel="noreferrer">Source</a>
        <span aria-hidden="true">·</span>
        <a href={`${REPO_URL}/blob/main/README.md`} target="_blank" rel="noreferrer">About</a>
        <span aria-hidden="true">·</span>
        <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">Report an issue</a>
        <span aria-hidden="true">·</span>
        <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT License</a>
        {installButton && <span aria-hidden="true">·</span>}
        {installButton}
      </div>
      <div className="app-footer-row app-footer-disclaimer">
        {BRAND.appName} provides nutrition estimates for informational purposes only and is not medical advice. Consult a qualified professional for dietary decisions.
      </div>
    </footer>
  )
}
