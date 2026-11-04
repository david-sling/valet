// The handover with yellow emoji hands, posed after The Creation of Adam: the agent's palm-up hand reaches in
// from the left edge, the client's palm-down hand from the right, and a horizontal valet ticket waits between them.
// Two sets: Google's Noto (Apache 2.0, the default) and Microsoft's Fluent 3D (MIT), via ?set=fluent.
// The ticket tears along its perforation, fibre by fibre: the red body goes to the agent, the cream stub to the client.
window.valetHands3d = function (set) {
  const FLUENT = "https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@1ffb34c752ecf5d402f04cfb4b392c77f57c54bc/assets";
  const NOTO = "https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.048/png/512";
  const img = set === "fluent"
    ? { up: `${FLUENT}/Palm%20up%20hand/Default/3D/palm_up_hand_3d_default.png`,
        down: `${FLUENT}/Palm%20down%20hand/Default/3D/palm_down_hand_3d_default.png` }
    : { up: `${NOTO}/emoji_u1faf4.png`, down: `${NOTO}/emoji_u1faf3.png` };
  const T = valetTicketGeometry();
  // holes punched along the perforation, plus a notch at each end; the mask moves with each half
  const holes = T.bridges.slice(0, -1).map((b) => `<circle cx="${T.x}" cy="${(b.y1 + T.hole / 2).toFixed(2)}" r="${T.hole / 2}" fill="#000"/>`).join("");
  return `
<div class="h3d" data-set="${set === "fluent" ? "fluent" : "noto"}" role="img" aria-label="Two hands reaching in from opposite sides toward a valet ticket, posed like The Creation of Adam">
  <div class="hand-agent"><img src="${img.up}" alt="" draggable="false"></div>
  <div class="ticket-hold">
    <svg class="ticket" viewBox="0 0 ${T.w} ${T.h}" aria-hidden="true">
      <defs>
        <mask id="h3d-perf" maskUnits="userSpaceOnUse" x="-400" y="-400" width="1000" height="900">
          <rect x="-400" y="-400" width="1000" height="900" fill="#fff"/>
          ${holes}
          <circle cx="${T.x}" cy="0" r="${T.notch}" fill="#000"/><circle cx="${T.x}" cy="${T.h}" r="${T.notch}" fill="#000"/>
        </mask>
      </defs>
      <g class="body">
        <path mask="url(#h3d-perf)" fill="#e2412f" d="M12 0 H${T.x} V${T.h} H12 A12 12 0 0 1 0 ${T.h - 12} V12 A12 12 0 0 1 12 0Z"/>
        <text x="18" y="40" fill="#fbf3e3" font-family="Funnel Display, sans-serif" font-weight="800" font-size="24" letter-spacing="-0.5">Valet</text>
        <text x="18" y="60" fill="#f6b8ad" font-family="Geist Mono, monospace" font-size="8.5" letter-spacing="0.6">SESSION NO. 0042</text>
        <text x="18" y="76" fill="#f6b8ad" font-family="Geist Mono, monospace" font-size="8.5" letter-spacing="0.6">60 MIN · 3 GRANTS</text>
      </g>
      <g class="fibres" fill="none" stroke="#f3dcb0" stroke-linecap="round"></g>
      <g class="stub">
        <path mask="url(#h3d-perf)" fill="#efd09b" d="M${T.x} 0 H${T.w - 12} A12 12 0 0 1 ${T.w} 12 V${T.h - 12} A12 12 0 0 1 ${T.w - 12} ${T.h} H${T.x}Z"/>
        <text transform="translate(${T.x + 26} ${T.h / 2}) rotate(-90)" text-anchor="middle" fill="#8a6a35" font-family="Geist Mono, monospace" font-size="8" letter-spacing="0.8">CLIENT COPY</text>
        <text transform="translate(${T.x + 42} ${T.h / 2}) rotate(-90)" text-anchor="middle" fill="#5c4520" font-family="Funnel Display, sans-serif" font-weight="800" font-size="12">0042</text>
      </g>
    </svg>
  </div>
  <div class="hand-client"><img src="${img.down}" alt="" draggable="false"></div>
</div>`;
};

// The ticket's shape in viewBox units: body 0..x, stub x..w, with paper bridges between the perforation holes.
window.valetTicketGeometry = function () {
  const T = { w: 200, h: 96, x: 138, notch: 6, hole: 4.4, holes: 9, stretch: 10, limit: (26 * Math.PI) / 180 };
  const span = T.h - 2 * T.notch;
  const bridge = (span - T.holes * T.hole) / (T.holes + 1);
  T.hinge = { x: T.x, y: T.h - T.notch }; // the stub swings open from the bottom of the perforation
  T.bridges = [];
  for (let i = 0; i <= T.holes; i += 1) {
    const y0 = T.notch + i * (bridge + T.hole);
    T.bridges.push({ y0, y1: y0 + bridge, mid: y0 + bridge / 2 });
  }
  return T;
};

// Draws the tear for a scroll position. tear 0..1 swings the stub open while the fibres stretch and snap;
// part 0..1 carries each half's centre to an offset in pixels from where it started (to.body, to.stub).
// The two overlap, so the tear runs straight on into the halves travelling.
window.valetTear = function (svg) {
  const T = valetTicketGeometry();
  const ns = "http://www.w3.org/2000/svg";
  const body = svg.querySelector(".body");
  const stub = svg.querySelector(".stub");
  const layer = svg.querySelector(".fibres");
  const fibres = T.bridges.map(() => [0, 1].map(() => layer.appendChild(document.createElementNS(ns, "path"))));
  const f = (n) => n.toFixed(2);
  return (tear, part, to) => {
    const k = svg.clientWidth / T.w || 1; // px per unit
    const th = tear * T.limit;
    const slack = 12 * tear * tear; // the stub also pulls away a little, so the last fibres by the hinge go too
    const cos = Math.cos(th), sin = Math.sin(th);
    const shrink = 1 - 0.22 * part; // each half eases down in size as it travels
    const sc = (cx, cy) => `translate(${cx} ${cy}) scale(${f(shrink)}) translate(${-cx} ${-cy})`;
    // the stub turns about the hinge, so its centre drifts; aim the centre, not the hinge, at its target
    const turn = th + (part * 12 * Math.PI) / 180;
    const cx = (T.x + T.w) / 2 - T.hinge.x, cy = T.h / 2 - T.hinge.y;
    const aimX = cx - (cx * Math.cos(turn) - cy * Math.sin(turn)) + to.stub.x / k;
    const aimY = cy - (cx * Math.sin(turn) + cy * Math.cos(turn)) + to.stub.y / k;
    const sx = slack + (aimX - slack) * part, sy = aimY * part;
    stub.setAttribute("transform", `translate(${f(sx)} ${f(sy)}) rotate(${f((turn * 180) / Math.PI)} ${T.hinge.x} ${T.hinge.y}) ${sc((T.x + T.w) / 2, T.h / 2)}`);
    body.setAttribute("transform", `translate(${f((part * to.body.x) / k)} ${f((part * to.body.y) / k)}) rotate(${f(part * -8)} ${T.x / 2} ${T.h / 2}) ${sc(T.x / 2, T.h / 2)}`);
    T.bridges.forEach((b, i) => {
      const [near, far] = fibres[i];
      // where this bridge's stub edge has moved to, against where it was torn from
      const dy = b.mid - T.hinge.y;
      const tx = T.hinge.x - dy * sin + slack, ty = T.hinge.y + dy * cos;
      const gx = tx - T.x, gy = ty - b.mid, gap = Math.hypot(gx, gy);
      const fade = Math.max(0, 1 - part * 5); // any last fibres let go as the halves start to travel
      if (fade === 0 || gap < 0.3) { near.style.opacity = far.style.opacity = 0; return; }
      if (gap < T.stretch) {
        // still holding: two fibres stretch and thin across the gap, sagging slightly
        const w = f(1.7 - 1.15 * (gap / T.stretch)), sag = gap * 0.18;
        near.setAttribute("d", `M${f(T.x)},${f(b.mid - 1.4)}Q${f(T.x + gx / 2)},${f(b.mid - 1.4 + gy / 2 + sag)} ${f(tx)},${f(ty - 1.4)}`);
        far.setAttribute("d", `M${f(T.x)},${f(b.mid + 1.4)}Q${f(T.x + gx / 2)},${f(b.mid + 1.4 + gy / 2 - sag)} ${f(tx)},${f(ty + 1.4)}`);
        near.style.strokeWidth = far.style.strokeWidth = w;
        near.style.opacity = far.style.opacity = fade;
        return;
      }
      // snapped: the loose ends curl back towards their own edges as the gap widens
      const left = Math.max(0, 1 - (gap - T.stretch) / T.stretch) ** 2;
      const len = T.stretch * 0.5 * left, ux = gx / gap, uy = gy / gap;
      near.setAttribute("d", `M${f(T.x)},${f(b.mid)}L${f(T.x + ux * len)},${f(b.mid + uy * len)}`);
      far.setAttribute("d", `M${f(tx)},${f(ty)}L${f(tx - ux * len)},${f(ty - uy * len)}`);
      near.style.strokeWidth = far.style.strokeWidth = 0.9;
      near.style.opacity = far.style.opacity = left * fade;
    });
  };
};
