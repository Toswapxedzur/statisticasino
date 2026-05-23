---
title: "Welcome to Statisticasino"
slug: welcome
date: 2026-05-19
description: "What this site is for, why it exists, and how to contribute data."
---

This site aggregates poker hand captures from anyone running the companion Chrome extension, `casinoMalwareExtension`. By simply playing your normal rounds on casino.org's Replay Poker and dropping your generated `.casinodump` file onto the [Upload](/upload) page, your hands will automatically join a growing, centralized database. Every piece of data is meticulously organized by the casino-side player whose perspective it was captured from, all fully accessible and explorable on the [Data](/data) page.

## Why We Built Statisticasino

The creation of this platform is driven by a few core intentions, blending rigorous academic utility with a highly practical competitive edge.

### Empowering Future AP Statistics Students
Finding high-quality, truly random datasets in the wild is notoriously difficult for students learning statistical inference. Statisticasino is built to serve as a living, breathing goldmine for future AP Statistics students. By providing a massive, structured repository of parsed poker hands, students can run genuine hypothesis tests, calculate confidence intervals, and perform chi-square goodness-of-fit tests on real-world data rather than relying on sanitized textbook examples. 

### Deepening Statistical Understanding
Poker is applied mathematics. By reviewing captured hands, calculating expected value (EV), and analyzing variance over thousands of rounds, the abstract concepts of statistics become concrete. This project is designed to deepen your understanding of probability and game theory through the lens of interesting, complex, and sometimes entirely unpredictable casino plays. 

### Creating an Unfair Advantage
Let’s be completely transparent: this database is also designed to provide an outright unfair advantage to students in our school who play on casino.org. By pooling our data, we can build a comprehensive map of the platform's ecosystem. We can identify opponent tendencies, map out betting patterns, and analyze the platform's underlying mechanics with a level of precision that solo players simply cannot match. When you sit at a table armed with aggregate data from dozens of your peers, you are no longer guessing—you are operating with asymmetric information.

### Zero Drawbacks to Participation
There is absolutely no downside to running the extension, recording the data, and holding it. The `casinoMalwareExtension` is strictly read-only. It passively listens to HTTP and WebSocket traffic in the background and stores the grouped tables directly into your browser's `chrome.storage.local`. 

Network egress is entirely user-initiated—nothing leaves your machine until you explicitly click "Export" or "Flush now." It requires negligible computing overhead, interferes with zero gameplay mechanics, and costs nothing to run, yet it yields a massive analytical payoff for the collective database.

## The Blog: Where Investigations Live

This section of the site is where all of our investigation results, data analyses, and tactical write-ups live. 

Posts are authored as plain markdown files located in `content/blog/`. The architecture is intentionally simple: if you uncover a fascinating statistical anomaly or a profitable opponent exploit, you can write it up using standard markdown syntax, drop it in the directory, and the SvelteKit backend will immediately pick up the change on refresh using `gray-matter` and `marked`. 

Start capturing, start uploading, and let the data do the talking.
