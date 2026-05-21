---
title: "Welcome to Statisticasino"
slug: welcome
date: 2026-05-19
description: "What this site is for and how to contribute data."
---

This site aggregates poker hand captures from anyone running the
companion Chrome extension. Drop your `.casinodump` file on the
[Upload](/upload) page and your hands will join the rest, organised by
the casino-side player whose perspective they were captured from on the
[Data](/data) page.

## One row per perspective

When the same round is captured by two different in-game players, both
versions are kept side-by-side under each player's branch — they're
not merged. The replay panel highlights the perspective-owner's seat
in red.

Captures with no visible hole cards (pure spectator dumps) are
rejected as *generic*.

## Blog

This is where investigation results live. Posts are plain markdown
files in `content/blog/`; edit them however you want and the site
picks up the change on refresh.
