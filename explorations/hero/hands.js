// The handover illustration: the client's hand (red cuff, top right) gives the key,
// the agent's hand (blue cuff, bottom left) receives it. The red ticket on the key ring
// tears at its notch: the cream stub (.stub) is the client's copy.
// Parts carry classes so each page can animate them: .hand-client, .key, .ticket, .stub, .hand-agent.
window.valetHands = function () {
  const O = "#231c3f", W = 7, SKIN = "#ffc6a5", SKIN_HI = "#ffe2d1";
  const s = `stroke="${O}" stroke-width="${W}" stroke-linejoin="round" stroke-linecap="round"`;
  return `
<svg class="hands" viewBox="0 0 600 560" role="img" aria-label="One hand handing a key with a valet ticket to another, open hand">
  <g class="hand-agent"><g transform="translate(0 40)">
    <g transform="rotate(-18 60 430)">
      <rect x="-60" y="368" width="96" height="124" fill="#b9d0ff" ${s}/>
      <rect x="30" y="358" width="46" height="144" rx="10" fill="#4f6bff" ${s}/>
      <circle cx="53" cy="392" r="9" fill="#fff" ${s} stroke-width="5"/>
    </g>
    <path d="M86 384 C146 350 222 344 300 354 L432 342 C466 340 474 372 446 384 L362 404 C352 444 304 464 242 466 L104 474 Z" fill="${SKIN}" ${s}/>
    <path d="M306 392 L418 380" fill="none" ${s} stroke-width="5"/>
    <path d="M206 424 L306 424" fill="none" ${s} stroke-width="5"/>
    <path d="M150 378 C190 366 232 364 270 368" fill="none" stroke="${SKIN_HI}" stroke-width="9" stroke-linecap="round"/>
  </g></g>

  <g class="key">
    <path class="string" d="M262 150 C300 176 318 204 322 230" fill="none" ${s} stroke-width="4"/>
    <circle cx="262" cy="150" r="17" fill="none" ${s} stroke-width="6"/>
    <rect x="232" y="164" width="60" height="54" rx="13" fill="#3a2a94" ${s}/>
    <rect x="250" y="186" width="24" height="8" rx="4" fill="#b9d0ff"/>
    <path d="M250 218 L250 304 L264 304 L274 292 L274 218" fill="#b9d0ff" ${s}/>
    <g class="ticket">
      <path d="M284 230 H360 A12 12 0 0 1 372 242 V306 A10 10 0 0 0 372 324 H284 A10 10 0 0 0 284 306 V242 A12 12 0 0 1 284 230 Z" fill="#e2412f" ${s} stroke-width="5"/>
      <rect x="312" y="244" width="32" height="12" rx="6" fill="#fbfaf6" ${s} stroke-width="4"/>
      <path d="M298 276 H358 M298 292 H340" fill="none" stroke="#f6b8ad" stroke-width="5" stroke-linecap="round"/>
      <g class="stub">
        <path d="M284 332 H372 V364 A12 12 0 0 1 360 376 H296 A12 12 0 0 1 284 364 Z" fill="#efd09b" ${s} stroke-width="5"/>
        <path d="M300 352 H336" fill="none" stroke="#c9a46a" stroke-width="5" stroke-linecap="round"/>
      </g>
    </g>
  </g>

  <g class="hand-client">
    <rect x="496" y="64" width="140" height="146" fill="#fbfaf6" ${s}/>
    <rect x="462" y="52" width="46" height="170" rx="10" fill="#e2412f" ${s}/>
    <path d="M466 72 L336 62 C296 60 272 80 266 102 L258 142 C254 172 272 192 302 194 L466 202 Z" fill="${SKIN}" ${s}/>
    <path d="M444 140 L326 140 C300 140 298 176 326 176 L444 176" fill="${SKIN}" ${s}/>
    <path d="M266 118 L330 120" fill="none" ${s} stroke-width="5"/>
    <path d="M336 86 L410 88" fill="none" stroke="${SKIN_HI}" stroke-width="9" stroke-linecap="round"/>
  </g>
</svg>`;
};
