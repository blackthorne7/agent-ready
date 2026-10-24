// Owner-facing wording for the report page. Checks without an entry fall back to their rubric title and detail.

import type { Category, CheckResult } from "@/lib/audit/types";

type Plain = {
  /** The fix, as a to-do. */
  todo: string;
  /** Why it matters, in one sentence. */
  why: string;
  /** Shown under "Already working" when the check passes. */
  good?: string;
};

export const PLAIN: Record<string, Plain> = {
  meta: {
    todo: "Give your pages a clear title and description",
    why: "AI uses these to describe your business in a line.",
    good: "Your page title and description are clear",
  },
  "heading-order": {
    todo: "Put your page headings in order",
    why: "Clear headings help AI follow how your page is organized.",
    good: "Your headings are in a sensible order",
  },
  "structured-data": {
    todo: "Describe your business in a format AI reads",
    why: "AI reads a hidden summary of your business. Your site doesn't have one yet.",
    good: "AI can read a summary of your business",
  },
  "robots-ai-agents": {
    todo: "Let AI assistants into your site",
    why: "Your site's settings tell some AI assistants to stay out.",
    good: "AI assistants are allowed on your site",
  },
  sitemap: {
    todo: "Add a list of all your pages",
    why: "So AI can find every page, not just your homepage.",
    good: "AI can find all your pages",
  },
  "llms-txt": {
    todo: "Add a short guide written for AI",
    why: "So AI describes your business the way you would.",
    good: "You have a guide written for AI",
  },
  "server-rendered": {
    todo: "Make your words readable without extra loading",
    why: "Some AI can't run the code your site needs to show its text.",
    good: "Your words are readable, not hidden behind code",
  },
  "nav-real-links": {
    todo: "Make your menu items real links",
    why: "AI can't follow menu items that only work when a person clicks them.",
    good: "Your menu links work for AI",
  },
  "business-info": {
    todo: "Say who you are, where you are and when you're open",
    why: "AI can't confirm your address, phone number or opening hours.",
    good: "AI can tell who you are, where you are and when you're open",
  },
  offerings: {
    todo: "List what you sell, with prices",
    why: "AI can't answer “what's on the menu?” or “how much is it?”.",
    good: "AI can read what you offer and your prices",
  },
  contact: {
    todo: "Add contact details AI can read",
    why: "Add a phone number and email address AI can pick up.",
    good: "AI can find how to contact you",
  },
  "controls-named": {
    todo: "Name every button and link",
    why: "Buttons that are only an icon have no name AI can read.",
    good: "Your buttons and links have names",
  },
  "forms-labeled": {
    todo: "Label every form field",
    why: "AI fills in forms by reading the labels.",
    good: "Your forms are clearly labeled",
  },
  "input-types": {
    todo: "Use the right field types in your forms",
    why: "So AI knows where the email, phone and date go.",
    good: "Your form fields ask for the right things",
  },
  "native-controls": {
    todo: "Use real buttons and links",
    why: "AI can miss things that only look clickable.",
    good: "Your buttons and links are real ones",
  },
  "distinct-labels": {
    todo: "Make similar buttons easy to tell apart",
    why: "When several buttons say the same thing, AI can't tell which to press.",
    good: "Your buttons are easy to tell apart",
  },
  "images-alt": {
    todo: "Describe your images in words",
    why: "AI can't see pictures. It reads their descriptions.",
    good: "Your images have descriptions",
  },
  feeds: {
    todo: "Offer a news or blog feed",
    why: "Feeds let AI keep up with your latest posts and offers.",
    good: "AI can follow your latest updates",
  },
  "no-hidden-dom": {
    todo: "Don't hide content inside embedded frames",
    why: "AI can't read content embedded from another site.",
    good: "Nothing is hidden where AI can't read it",
  },
  "tasks-completed": {
    todo: "Make common tasks easier to finish",
    why: "Our AI agent couldn't finish what a customer would ask for.",
    good: "Our AI agent finished what customers ask for",
  },
  "search-works": {
    todo: "Make your site search work for AI",
    why: "AI uses your search box to find things for customers.",
    good: "Your site search works for AI",
  },
  "multistep-predictable": {
    todo: "Make step-by-step forms predictable",
    why: "AI loses its place when steps change unexpectedly.",
    good: "Step-by-step flows behave predictably",
  },
  repeatable: {
    todo: "Make results consistent",
    why: "AI got different results trying the same thing twice.",
    good: "AI gets the same result every time",
  },
  "task-efficiency": {
    todo: "Cut the number of clicks to get things done",
    why: "AI gives up when a task takes too many steps.",
    good: "Tasks take a reasonable number of steps",
  },
  "no-login-redirect": {
    todo: "Don't send visitors to a login page unexpectedly",
    why: "AI can't log in, so a surprise login page stops it.",
    good: "No surprise login pages",
  },
  "login-clarity": {
    todo: "Say clearly when a login is needed",
    why: "AI wastes steps on pages it can't use.",
    good: "It's clear when a login is needed",
  },
  "search-in-url": {
    todo: "Keep searches and filters in the page address",
    why: "So AI can share and reopen a search.",
    good: "Searches and filters can be shared as links",
  },
  pagination: {
    todo: "Use numbered pages, not only endless scrolling",
    why: "AI can't scroll forever to reach older items.",
    good: "Long lists have pages AI can step through",
  },
  "stable-selectors": {
    todo: "Keep your page structure stable",
    why: "AI finds its way around more reliably when pages don't change between visits.",
    good: "Your page structure is stable",
  },
  "cookie-security": {
    todo: "Secure your login cookies",
    why: "Your web person will know this one: set Secure, HttpOnly and SameSite.",
    good: "Your login cookies are secure",
  },
  "agent-protocols": {
    todo: "Give AI a direct way to book, order or sign up",
    why: "Right now AI has to click through your site like a person, and often gives up.",
    good: "AI has a direct way to work with your business",
  },
  actions: {
    todo: "Tell AI what customers can do on your site",
    why: "Point AI to your booking, ordering or search pages.",
    good: "AI knows what customers can do on your site",
  },
  "readable-urls": {
    todo: "Use clear, stable page addresses",
    why: "AI shares and revisits links. Messy addresses break.",
    good: "Your page addresses are clear",
  },
  "no-new-tabs": {
    todo: "Open links in the same tab",
    why: "Links that open new tabs can lose AI along the way.",
    good: "Links open in the same tab",
  },
  "response-time": {
    todo: "Make your pages load faster",
    why: "AI gives up on pages that take too long.",
    good: "Your pages load quickly",
  },
  "no-bot-wall": {
    todo: "Stop blocking AI at the door",
    why: "A security check is turning AI assistants away.",
    good: "Nothing blocks AI at the door",
  },
  "no-hidden-instructions": {
    todo: "Remove hidden text aimed at AI",
    why: "Hidden instructions make AI assistants distrust your site.",
    good: "No hidden text trying to trick AI",
  },
  "no-exposed-secrets": {
    todo: "Remove private details from your page code",
    why: "Anyone, including AI, can read what's in your page code.",
    good: "No private details exposed in your pages",
  },
};

export const todoFor = (c: Pick<CheckResult, "id" | "title">) => PLAIN[c.id]?.todo ?? c.title;
export const whyFor = (c: Pick<CheckResult, "id" | "detail">) => PLAIN[c.id]?.why ?? c.detail;
export const goodFor = (c: Pick<CheckResult, "id" | "title">) => PLAIN[c.id]?.good ?? c.title;

/** The three questions an owner cares about, each built from rubric categories. */
export const AREAS = [
  { key: "find", label: "Find and read you", categories: ["A"] as Category[], can: "find and read your site" },
  { key: "use", label: "Use your pages", categories: ["B", "E", "F"] as Category[], can: "use your pages" },
  { key: "act", label: "Act for customers", categories: ["C", "D"] as Category[], can: "act for your customers" },
] as const;

/** What the agent hit, in a sentence. Its full reasoning stays in the technical details. */
export const TASK_STUCK: Record<string, string> = {
  "find-pricing": "It couldn't find your prices.",
  "find-contact": "It couldn't find a way to contact you.",
  "primary-action": "It couldn't get through your booking, ordering or sign-up form.",
};

/** Which check an agent task's failure points to, so the task's result can sit next to that fix. */
export const TASK_CHECK: Record<string, string[]> = {
  "find-pricing": ["offerings"],
  "find-contact": ["contact", "business-info"],
  "primary-action": ["agent-protocols", "actions", "forms-labeled"],
};
