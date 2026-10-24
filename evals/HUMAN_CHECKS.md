# Human-Friendliness: What We Check

> Each check is grouped under the score category it feeds.
> These are automated stand-ins for real user testing, not a replacement for it.

---

## A. Can a person understand it? (Clarity & Readability — 20 pts)

- [ ] Page purpose is clear within a few seconds (clear headline / title)
- [ ] Language is plain (reasonable reading level, little jargon)
- [ ] Content is broken into scannable sections with headings
- [ ] Body text is a readable size (about 16px or larger)
- [ ] Text has enough contrast against its background (4.5:1, or 3:1 for large text)
- [ ] Lines aren't too long or too cramped
- [ ] Prices, fees, and terms are stated clearly
- [ ] Instructions are clear where action is needed

## B. Can a person find things? (Navigation & Findability — 15 pts)

- [ ] Menu labels are understandable (no clever or vague names)
- [ ] Navigation is the same across pages
- [ ] Site search exists where needed and gives relevant results
- [ ] Filtering and sorting work and are easy to use
- [ ] Important info (contact, pricing, policies) is easy to locate
- [ ] User can tell where they are (breadcrumbs, highlighted menu item)
- [ ] Easy to get back home or up a level from deep pages

## C. Can a person complete tasks easily? (Task Completion & Interaction — 25 pts)

- [ ] Tasks take a reasonable number of steps
- [ ] Forms ask only for what's needed
- [ ] Required fields are clearly marked
- [ ] Error messages explain what went wrong and how to fix it
- [ ] Errors appear next to the field they're about
- [ ] Typed input is kept after an error (not wiped)
- [ ] Clear feedback after actions (loading, success, error)
- [ ] Progress shown in multi-step flows (step 2 of 4)
- [ ] User can review before submitting anything important
- [ ] Easy to recover after a wrong click

## D. Can everyone use it? (Accessibility — 20 pts, WCAG 2.2 as reference)

- [ ] Everything works with keyboard only (Tab, Enter, Esc)
- [ ] Keyboard focus is visible and not hidden behind sticky headers
- [ ] No keyboard traps (can always Tab out)
- [ ] "Skip to content" link exists
- [ ] Buttons, links, and fields have names a screen reader can announce
- [ ] Meaningful images have alt text
- [ ] Page still works at 200% zoom
- [ ] Page works at narrow width (320px) without sideways scrolling
- [ ] Errors are announced, not shown by color alone
- [ ] Animations respect the "reduce motion" setting
- [ ] No autoplaying audio
- [ ] Alternatives exist for barriers (e.g. CAPTCHA has an accessible option)

## E. Does it look and work well on any screen? (Visual & Responsive — 10 pts)

- [ ] Layout is consistent across pages
- [ ] Works well on mobile (readable without zooming, nothing cut off)
- [ ] Tap targets are big enough (at least 24px, ideally 44px) and not crowded
- [ ] Clear visual hierarchy (most important thing stands out)
- [ ] Not cluttered (few competing buttons, ads, animations)
- [ ] Popups and overlays don't cover essential content
- [ ] Page loads quickly and doesn't jump around while loading

## F. Can a person trust it and stay in control? (Trust, Privacy & Control — 10 pts)

- [ ] All mandatory fees shown up front, not added at the end
- [ ] Recurring charges and subscription terms are clear
- [ ] Privacy policy is easy to find and understand
- [ ] User can change settings and preferences
- [ ] Consequences of important actions are clear (e.g. "this will charge your card")
- [ ] Mistakes can be undone or corrected
- [ ] No deceptive design patterns:
  - [ ] No guilt-trip buttons ("No thanks, I don't like saving money")
  - [ ] No fake countdowns or fake "only 2 left"
  - [ ] No pre-checked opt-ins
  - [ ] No items sneaked into the cart
  - [ ] Cancelling is as easy as signing up
  - [ ] Ads aren't disguised as content
  - [ ] No repeated nagging popups

## G. Cookies, Consent & Sessions (person's view)

> Reported as its own diagnostic section. When a check fails, it counts once toward the category shown in brackets (no double-counting).
> Using cookies is **not** a problem by itself.
> **No separate score:** every check here already counts toward one of the categories A–F above (see brackets), so cookie issues are scored once, never twice.

### Cookie consent banner
- [ ] Banner doesn't cover the content the person came for *(→ E)*
- [ ] Accept, Reject, and Preferences are written in plain language *(→ A)*
- [ ] Reject is as visible and easy as Accept (same number of clicks) *(→ F)*
- [ ] Banner is usable by keyboard and screen reader *(→ D)*
- [ ] Choice is remembered and the banner doesn't keep coming back *(→ E)*
- [ ] Rejecting doesn't break the site or punish the person *(→ F)*
- [ ] No tracking happens before consent or after rejecting *(→ F)*

### Remembering the person's progress
- [ ] Cart, filters, and settings stay while moving between pages *(→ C)*
- [ ] A page reload doesn't wipe what the person was doing *(→ C)*
- [ ] Form input isn't lost when going back a page *(→ C)*

### Login & sessions
- [ ] It's clear which pages need an account *(→ B)*
- [ ] After logging in, the person lands back where they were *(→ C)*
- [ ] Person is warned before a session times out *(→ C)*
- [ ] Timeout doesn't silently wipe progress *(→ C)*

### Other interruptions
- [ ] No location or notification prompts before the person does anything *(→ F)*
- [ ] No forced region/language redirect without a way to change it *(→ B)*
- [ ] Links don't unexpectedly open new tabs *(→ E)*
- [ ] CAPTCHAs are rare and have an accessible option *(→ D)*

---

## Example tasks by site type

| Site type | Tasks |
|---|---|
| E-commerce | Find a product and its full price · find the return policy · reach the cart and see totals (no purchase) |
| Documentation | Find how-to for a feature · find an example · understand prerequisites |
| SaaS | Understand what the product does · compare plans · find support |
| Travel | Search dates · understand total cost & cancellation terms (no booking) |
| Financial | Find fees & rates · understand the terms |
| Government | Find eligibility rules · find the right form · find contact/office hours |
| Any site | Find contact info · find privacy policy · use search · get back home from a deep page |
