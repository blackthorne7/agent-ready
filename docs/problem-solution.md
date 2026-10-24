# Agent Ready: Problem / Solution

## Who it's for

Any business owner with a website, including people who have never heard of an API, code, VS Code or Claude Code. They should understand the benefit within seconds.

## Problem

People are starting to shop and plan through AI agents like Claude, ChatGPT and Perplexity instead of searching themselves.

> "Find me a restaurant near here for a date, under $80 for two, Italian, and check the menu."

The agent visits restaurant websites and too often comes back with:

> "Sorry, I couldn't find the prices or menu items."

The same happens everywhere:

- **Restaurants:** no readable menu, prices or hours.
- **Auto shops:** the agent can't confirm a service is offered or book an appointment.
- **Hair salons, coffee shops, clinics, gyms, anything local:** services, prices and availability are hidden in images, PDFs or JavaScript, or blocked from agents entirely.

**The result:**

- **For the customer:** friction. They have to go back to doing it by hand.
- **For the business:** lost sales. The agent recommends the competitor whose website it *could* read.

Business owners can't see this happening, and they don't know how to fix it.

## Solution

**Agent Ready: like a Google SEO score, but for AI agents.**

1. **Score:** paste your website and get a simple score that tells you whether AI agents can find your business, understand what you offer (menu, prices, services, hours), and take action (order, book, contact).
2. **Plain-language report:** explains what's wrong in normal words. For example, "Agents can't see your menu prices."
3. **One-click fix link:** we store your report and the exact fixes in our database and give you **one link**.
   - **Non-technical:** paste the link into the tool you already use to build your site (Wix, Squarespace, Lovable, Bolt, Claude). The tool's AI reads the link and updates your website for you.
   - **Technical:** send the link to your developer, and their coding agent applies it.
4. **Re-check:** run the score again to confirm you're now agent ready.

## Why now

AI agents are becoming the new front door to local businesses. Being readable by agents will matter the way being on Google mattered in 2005.

## Landing page designs

Three directions to choose from, side by side on one canvas: https://claude.ai/artifact/MyR1WrJvLrYYwqL5TDRjd9

- **A · Main Street:** warm and local. An AI chat skips a restaurant whose menu it can't read.
- **B · Report Card:** led by the score. A big score ring and three plain-English questions.
- **C · The Conversation:** dark and story-led. "That 'sorry' is a lost customer."

## How it's built (for judges)

- Live audit engine with 13 checks in three groups: access, understanding, action.
- An MCP server (`audit_site`, `generate_fixes`), so agents can use Agent Ready directly.
- Deployed on Unikraft Cloud.
- Next: store reports and fix links in Supabase.
