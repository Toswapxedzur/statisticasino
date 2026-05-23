---
title: "Data Collection Guidelines: Avoiding Bias"
slug: data-collection-guidelines
date: 2026-05-22
pinned: true
description: "How to ensure the poker hands you upload contribute to a statistically sound dataset."
---

To draw accurate conclusions from the casino.org Replay Poker data aggregated on Statisticasino, the underlying dataset must be structurally sound. The value of this database relies entirely on the statistical independence of the uploaded hands. 

When capturing and uploading `.casinodump` files, it is highly critical to follow strict sampling protocols to prevent selection bias from skewing the aggregate data.

## The Principle of Independence

The most common threat to poker data analysis is cherry-picking. If users only activate the casinoMalwareExtension during highly unusual games, the dataset becomes useless for determining true probabilities or system behaviors.

You must not selectively upload hands based on their contents. Specifically, do not restrict your uploads to:
*   Winning sessions or massive pots.
*   Losing sessions, "bad beats," or suspected anomalous shuffles.
*   "Interesting" or highly aggressive table dynamics.

The decision to capture and upload a set of hands must be entirely independent of the events that occur within those hands.

## Acceptable Sampling Methods

You do not need to capture every single game you play. Partial data collection is perfectly fine, provided the selection criteria are predetermined and uncorrelated with the gameplay itself. 

To maintain an unbiased sample while only recording a fraction of your overall play, use one of the following systematic sampling methods:

*   **Time-Based Selection:** Decide on a fixed schedule before you play. For example, choose to only run the extension on Saturdays, or exclusively between 8:00 PM and 10:00 PM on Tuesdays. 
*   **Session-Based Selection:** Commit to recording a specific predefined subset of your sessions, such as every third time you log into the platform.
*   **Volume-Based Selection:** Record strictly the first 100 hands of any given session, regardless of how those hands unfold.

## Additional Requirements for Dataset Integrity

To further ensure the uploaded `.casinodump` files provide rigorous statistical value, adhere to the following operational rules:

### 1. Complete Session Adherence
Once you begin capturing a predetermined session, do not stop the extension prematurely. Terminating a capture early because you are experiencing a losing streak (or a winning streak) introduces survivorship bias into the dataset. If you commit to capturing a one-hour block, flush and export the data only after the full hour concludes.

### 2. Blinded Activation
Always activate the extension and begin capturing *before* you sit at a table and observe the opponents. Activating the tracker only after noticing a specific player or a particular betting pattern invalidates the independence of the sample.

### 3. Stake and Variant Consistency
If you apply a sampling rule (e.g., "recording every Friday"), ensure you apply it consistently across your standard stakes and game variants. Artificially restricting captures to high-stakes games while playing low-stakes unrecorded alters the dataset's representation of the platform's overall ecosystem.

### 4. Participant Perspectives Only
As a reminder of the system's baseline constraints, the ingest engine (`src/lib/server/ingest.js`) requires a defined perspective owner. Captures collected purely as a spectator with no visible hole cards are classified as generic and will be rejected by the database. You must be an active, seated participant for the data to be accepted into the canonical tree.
