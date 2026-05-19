---
title: "Welcome to Statisticasino"
slug: welcome
date: 2026-05-19
description: "What this site is for and how to contribute data."
---

This site aggregates poker hand captures from anyone running the companion Chrome extension. Drop your `.casinodump` file on the [Upload](/upload) page and your hands will join the rest under their respective tables on the [Data](/data) page.

## Multiple perspectives, one canonical hand

When two players upload the same hand (`tableId` + server `handId` match), the site merges them: the first upload's frames become the canonical record, and every subsequent upload contributes only its perspective's hole cards. Every uploader's seat is then highlighted red on the felt, so you can see at a glance who saw what.

## Blog

This is where investigation results live. Posts are plain markdown files in `content/blog/`; edit them however you want and the site picks up the change on refresh.
