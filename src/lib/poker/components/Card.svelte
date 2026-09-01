<script>
  // A single playing card. Faces are the real deck — Chris Aguilar's "Vector
  // Playing Cards 3.0" (LGPL 3.0) with the corner indices enlarged (the
  // "Replay treatment"), served from /cards/. The back + empty slot are drawn
  // inline to match the 63×88 real-card ratio.
  //
  //  card     — 2-char engine string ("As","Td"); null = empty slot.
  //  faceDown — show the card back.
  //  size     — layout token → render width.
  let { card = null, faceDown = false, size = "md" } = $props();

  const WIDTHS = { xs: 32, sm: 42, md: 62, lg: 82, xl: 108 };
  const RR = { A: "01", "2": "02", "3": "03", "4": "04", "5": "05", "6": "06",
    "7": "07", "8": "08", "9": "09", T: "10", J: "11", Q: "12", K: "13" };

  let width = $derived(WIDTHS[size] ?? WIDTHS.md);
  let height = $derived(Math.round((width * 88) / 63));

  let faceSrc = $derived.by(() => {
    if (!card || card.length < 2) return null;
    const r = card[0].toUpperCase(), s = card[1].toLowerCase();
    if (!RR[r] || !"shdc".includes(s)) return null;
    return `/cards/${s}${RR[r]}.svg`;
  });
</script>

{#if faceDown}
  <svg class="rvcard back" width={width} height={height} viewBox="0 0 63 88" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs><linearGradient id="rvb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#173463"/><stop offset="1" stop-color="#0b1a36"/></linearGradient></defs>
    <rect x="0.6" y="0.6" width="61.8" height="86.8" rx="6" fill="url(#rvb)"/>
    <rect x="4" y="4" width="55" height="80" rx="4" fill="none" stroke="#e6c260" stroke-opacity="0.85"/>
    <rect x="6.5" y="6.5" width="50" height="75" rx="3" fill="none" stroke="#e6c260" stroke-opacity="0.35" stroke-width="0.7"/>
    <circle cx="31.5" cy="44" r="12" fill="#0b1a36" stroke="#e6c260" stroke-opacity="0.7"/>
    <path transform="translate(31.5 44) scale(0.17)" fill="#e6c260" d="M0,-46 C-8,-30 -40,-18 -40,6 C-40,24 -22,34 -8,26 C-6,34 -12,40 -20,44 L20,44 C12,40 6,34 8,26 C22,34 40,24 40,6 C40,-18 8,-30 0,-46 Z"/>
  </svg>
{:else if faceSrc}
  <img class="rvcard face" src={faceSrc} width={width} height={height} alt={card} draggable="false" />
{:else}
  <svg class="rvcard empty" width={width} height={height} viewBox="0 0 63 88" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="1.5" y="1.5" width="60" height="85" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="1.3" stroke-dasharray="4 4"/>
  </svg>
{/if}

<style>
  .rvcard {
    display: block;
    line-height: 0;
    vertical-align: top;
    border-radius: 5px;
    user-select: none;
    -webkit-user-drag: none;
    backface-visibility: hidden;
  }
  .rvcard.face {
    background: #fff;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4));
  }
  .rvcard.back { filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5)); }
  .rvcard.empty { color: var(--muted, #8ea3bd); }
</style>
