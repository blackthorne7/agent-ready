# Agent-Friendliness: What We Check

> Each check is grouped under the score category it feeds.

---

## A. Can the agent find and read the content? (Discoverability — 15 pts)

- [ ] Page has a meaningful `<title>`
- [ ] Page has a meta description
- [ ] Headings are in a logical order (one H1, no skipped levels)
- [ ] Structured data (Schema.org / JSON-LD) exists and matches what's on the page
- [ ] `robots.txt` exists and doesn't block everything
- [ ] `sitemap.xml` exists and lists real pages
- [ ] `llms.txt` or other AI-friendly docs exist *(bonus signal, not required)*
- [ ] RSS/Atom feed exists where it makes sense (news, blogs)
- [ ] Important content is in the raw HTML, not only after JavaScript runs
- [ ] Navigation links are real links that can be followed

## B. Can the agent understand the controls? (Semantic Structure — 20 pts)

- [ ] Every button and link has a readable name (no unlabeled icons)
- [ ] Every form field has a label
- [ ] Form fields use the right type (email, number, date…)
- [ ] Real HTML buttons/links are used, not clickable `<div>`s
- [ ] Custom widgets (dropdowns, tabs, date pickers) expose roles and states
- [ ] Similar controls can be told apart (not five buttons all called "Learn more")
- [ ] Key content is text, not baked into images or canvas
- [ ] Content isn't hidden inside shadow DOM or cross-origin iframes

## C. Can the agent actually complete tasks? (Task Completion — 25 pts)

- [ ] Agent completes category-specific tasks correctly (e.g. find a product, find docs for a feature)
- [ ] Site search returns relevant results
- [ ] Filters and sorting work and give correct results
- [ ] Multi-step flows behave predictably
- [ ] Success and error messages can be detected in the page
- [ ] Agent can recover after a wrong click or error
- [ ] State (cart, filters, form input) is kept while navigating
- [ ] Same task gives the same result across repeated runs

## D. Can the agent access it programmatically? (Programmatic Access — 15 pts, N/A if not needed)

- [ ] Public API or OpenAPI spec exists *(if relevant to the site)*
- [ ] URLs are stable and readable
- [ ] Search/filter/page state appears in the URL (can be linked to directly)
- [ ] Pagination is predictable (not only infinite scroll)
- [ ] It's clear when login is required

## E. Is it robust and efficient? (Robustness — 15 pts)

- [ ] Tasks don't need an excessive number of actions
- [ ] Loading states are detectable (agent knows when the page is ready)
- [ ] Elements don't jump around while loading (layout shift)
- [ ] Element IDs/selectors are stable between page loads
- [ ] Menus work by click/focus, not only hover
- [ ] Popups, cookie banners, and modals can be dismissed
- [ ] Links don't unexpectedly open new tabs/windows
- [ ] Page works after a reload
- [ ] Pages load in reasonable time
- [ ] No frequent rate limiting (429) or bot challenges *(record only, never bypass)*

## F. Is it safe for an agent? (Safety — 10 pts)

- [ ] No hidden text with instructions aimed at AI agents (prompt injection)
- [ ] Risky actions (buy, delete, send) have a clear confirmation step
- [ ] Login and permission requirements are clear
- [ ] Sensitive data isn't exposed in URLs or page source

## G. Cookies, Consent, Sessions & Browser Behavior

> Reported as its own diagnostic section. When a check fails, it counts once toward the category shown in brackets (no double-counting).
> Using cookies is **not** a problem by itself.
> **No separate score:** every check here already counts toward one of the categories A–F above (see brackets), so cookie issues are scored once, never twice.

### Cookie consent banner
- [ ] Banner doesn't block the main content the agent needs *(→ E)*
- [ ] Accept, Reject, and Preferences buttons are clearly labeled and findable *(→ B)*
- [ ] Rejecting optional cookies still lets the agent use the site *(→ C)*
- [ ] Rejecting takes about the same effort as accepting *(→ F)*
- [ ] Choice is remembered across pages *(→ C)*
- [ ] Banner doesn't keep reappearing after a choice is made *(→ E)*
- [ ] No tracking cookies/requests fire before consent or after rejecting *(→ F)*

### Cookies & browser storage
- [ ] Needed state (cart, filters, language) survives moving between pages *(→ C)*
- [ ] State survives a page reload when it should *(→ E)*
- [ ] Session cookies have sensible security settings (`Secure`, `HttpOnly`, `SameSite`) *(→ F)*
- [ ] Site doesn't break when third-party cookies are blocked *(→ E)*

### Login & sessions
- [ ] Site doesn't unexpectedly redirect to a login page *(→ C)*
- [ ] It's clear which pages need login *(→ D)*
- [ ] After login, the agent is returned to where it was *(→ C)*
- [ ] Session timeout doesn't silently wipe progress *(→ C)*

### Other browser behaviors (record what happens)
- [ ] Popups / new tabs
- [ ] File downloads
- [ ] Permission prompts on load (location, notifications)
- [ ] Forced region or language redirects
- [ ] Site requires JavaScript to show anything
- [ ] Rate limiting (HTTP 429)
- [ ] CAPTCHA or bot-protection challenges *(record only, never bypass)*

---

## Example tasks by site type

| Site type | Tasks |
|---|---|
| E-commerce | Find a product matching requirements · compare two products · find total price with fees · add to cart (no purchase) |
| Documentation | Find how-to for a feature · find a code example · find required parameters |
| SaaS | Find pricing tiers · find a feature/setting · find workflow docs |
| Travel | Search dates · apply filters · find total price & restrictions · reach review step (no booking) |
| News | Find an article on a topic · find author & date |
| Government | Find eligibility rules · find a form |
| Any site | Find contact info · find privacy policy · use site search |
